// Background service worker — handles all Jira API calls (bypasses CORS)

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === 'JIRA_FETCH_TASKS') {
    fetchAllTasks(request.domain, request.auth)
      .then(function(data) { sendResponse({ ok: true, data: data }); })
      .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
    return true;
  }
  if (request.type === 'JIRA_FETCH_TICKET') {
    fetchTicketDetail(request.domain, request.auth, request.issueKey)
      .then(function(data) { sendResponse({ ok: true, data: data }); })
      .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
    return true;
  }
  if (request.type === 'JIRA_ADD_WORKLOG') {
    addWorklog(request.domain, request.auth, request.issueKey, request.timeSpent, request.comment, request.started)
      .then(function(data) { sendResponse({ ok: true, data: data }); })
      .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
    return true;
  }
  if (request.type === 'JIRA_FETCH_WORKLOGS') {
    fetchWorklogs(request.domain, request.auth, request.issueKey)
      .then(function(data) { sendResponse({ ok: true, data: data }); })
      .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
    return true;
  }
  if (request.type === 'JIRA_FETCH_UNASSIGNED') {
    fetchUnassignedTasks(request.domain, request.auth, request.projectKey)
      .then(function(data) { sendResponse({ ok: true, data: data }); })
      .catch(function(err) { sendResponse({ ok: false, error: err.message }); });
    return true;
  }
});

// ── HTTP helpers ───────────────────────────────────────────────────────────
async function jiraGet(url, auth) {
  var res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' }
    });
  } catch (e) { throw new Error('Network error: ' + e.message); }
  return handleResponse(res);
}

async function jiraPost(url, auth, body) {
  var res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) { throw new Error('Network error: ' + e.message); }
  return handleResponse(res);
}

async function handleResponse(res) {
  if (!res.ok) {
    var detail = '';
    try { var j = await res.json(); detail = j.message || (j.errorMessages && j.errorMessages[0]) || ''; } catch(_) {}
    if (res.status === 401) throw new Error('Invalid credentials — check your email and API token.');
    if (res.status === 403) throw new Error('Access denied — your token may lack permissions.');
    if (res.status === 404) throw new Error('Issue not found.');
    if (res.status === 429) throw new Error('Rate limited — please wait and try again.');
    throw new Error('Jira API error ' + res.status + (detail ? ': ' + detail : ''));
  }
  // 204 No Content has no body
  if (res.status === 204) return {};
  return res.json();
}

// ── Fetch tasks ────────────────────────────────────────────────────────────
async function fetchAllTasks(domain, auth) {
  var base = 'https://' + domain;
  await jiraGet(base + '/rest/api/3/myself', auth);

  var jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
  var taskPageSize = 100, taskStart = 0, allIssues = [], taskTotal = Infinity;
  while (taskStart < taskTotal) {
    var taskUrl = base + '/rest/api/3/search/jql'
      + '?jql=' + encodeURIComponent(jql)
      + '&maxResults=' + taskPageSize
      + '&startAt=' + taskStart
      + '&fields=summary,status,priority,issuetype,project';
    var data = await jiraGet(taskUrl, auth);
    var page = data.issues || [];
    allIssues = allIssues.concat(page);
    taskTotal = typeof data.total === 'number' ? data.total : allIssues.length;
    taskStart += page.length;
    if (!page.length) break;
  }

  var tasks = allIssues.map(function(issue) {
    return {
      key: issue.key,
      summary: issue.fields.summary || '(no title)',
      status: (issue.fields.status && issue.fields.status.name) || 'Unknown',
      statusCategory: (issue.fields.status && issue.fields.status.statusCategory && issue.fields.status.statusCategory.key) || 'new',
      priority: (issue.fields.priority && issue.fields.priority.name) || 'Medium',
      type: (issue.fields.issuetype && issue.fields.issuetype.name) || 'Task',
      projectKey: (issue.fields.project && issue.fields.project.key) || '?',
      projectName: (issue.fields.project && issue.fields.project.name) || 'Unknown',
      url: base + '/browse/' + issue.key,
    };
  });

  var projectMap = {};
  tasks.forEach(function(t) {
    if (!projectMap[t.projectKey]) projectMap[t.projectKey] = { key: t.projectKey, name: t.projectName, count: 0 };
    projectMap[t.projectKey].count++;
  });

  // Fetch ALL accessible projects via pagination and merge into the map
  try {
    var startAt = 0, pageSize = 50, isLast = false;
    while (!isLast) {
      var page = await jiraGet(
        base + '/rest/api/3/project/search?maxResults=' + pageSize + '&startAt=' + startAt + '&orderBy=name',
        auth
      );
      (page.values || []).forEach(function(p) {
        if (!projectMap[p.key]) projectMap[p.key] = { key: p.key, name: p.name, count: 0 };
      });
      isLast = page.isLast !== false ? true : (page.values || []).length < pageSize;
      startAt += (page.values || []).length;
      if (!(page.values || []).length) break;
    }
  } catch(_) {}

  var projects = Object.values(projectMap).sort(function(a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });

  return { tasks: tasks, projects: projects };
}

// ── Fetch ticket detail ────────────────────────────────────────────────────
async function fetchTicketDetail(domain, auth, issueKey) {
  var base = 'https://' + domain;
  var fields = 'summary,status,priority,issuetype,project,assignee,reporter,description,comment,created,updated,duedate,labels,components,subtasks,parent,timetracking';
  var data = await jiraGet(base + '/rest/api/3/issue/' + issueKey + '?fields=' + fields, auth);

  function adfToText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (node.content) return node.content.map(adfToText).join('');
    return '';
  }

  var f = data.fields;
  var comments = [];
  if (f.comment && f.comment.comments) {
    comments = f.comment.comments.slice(-5).map(function(c) {
      return {
        author: (c.author && c.author.displayName) || 'Unknown',
        body: adfToText(c.body),
        created: c.created,
      };
    });
  }

  return {
    key: data.key,
    summary: f.summary || '',
    status: (f.status && f.status.name) || '',
    statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || 'new',
    priority: (f.priority && f.priority.name) || 'Medium',
    type: (f.issuetype && f.issuetype.name) || 'Task',
    project: (f.project && f.project.name) || '',
    projectKey: (f.project && f.project.key) || '',
    assignee: (f.assignee && f.assignee.displayName) || 'Unassigned',
    reporter: (f.reporter && f.reporter.displayName) || 'Unknown',
    description: adfToText(f.description),
    created: f.created,
    updated: f.updated,
    duedate: f.duedate,
    labels: f.labels || [],
    components: (f.components || []).map(function(c) { return c.name; }),
    subtasks: (f.subtasks || []).map(function(s) { return { key: s.key, summary: s.fields.summary, status: s.fields.status && s.fields.status.name }; }),
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields && f.parent.fields.summary } : null,
    comments: comments,
    timetracking: {
      originalEstimate: (f.timetracking && f.timetracking.originalEstimate) || null,
      timeSpent: (f.timetracking && f.timetracking.timeSpent) || null,
      remainingEstimate: (f.timetracking && f.timetracking.remainingEstimate) || null,
    },
    url: base + '/browse/' + data.key,
  };
}

// ── Fetch worklogs for an issue ────────────────────────────────────────────
async function fetchWorklogs(domain, auth, issueKey) {
  var base = 'https://' + domain;
  var data = await jiraGet(base + '/rest/api/3/issue/' + issueKey + '/worklog', auth);
  var worklogs = (data.worklogs || []).slice(-10).reverse().map(function(w) {
    return {
      id: w.id,
      author: (w.author && w.author.displayName) || 'Unknown',
      timeSpent: w.timeSpent || '',
      timeSpentSeconds: w.timeSpentSeconds || 0,
      comment: w.comment ? extractText(w.comment) : '',
      started: w.started,
    };
  });
  return { worklogs: worklogs, total: data.total || 0 };
}

function extractText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.content) return node.content.map(extractText).join('');
  return '';
}

// ── Fetch unassigned tasks for a project ──────────────────────────────────
async function fetchUnassignedTasks(domain, auth, projectKey) {
  var base = 'https://' + domain;
  var jql = 'project = "' + projectKey + '" AND assignee is EMPTY AND statusCategory != Done ORDER BY updated DESC';
  var url = base + '/rest/api/3/search/jql'
    + '?jql=' + encodeURIComponent(jql)
    + '&maxResults=50'
    + '&fields=summary,status,priority,issuetype,project';

  var data = await jiraGet(url, auth);
  return (data.issues || []).map(function(issue) {
    return {
      key: issue.key,
      summary: issue.fields.summary || '(no title)',
      status: (issue.fields.status && issue.fields.status.name) || 'Unknown',
      statusCategory: (issue.fields.status && issue.fields.status.statusCategory && issue.fields.status.statusCategory.key) || 'new',
      priority: (issue.fields.priority && issue.fields.priority.name) || 'Medium',
      type: (issue.fields.issuetype && issue.fields.issuetype.name) || 'Task',
      projectKey: (issue.fields.project && issue.fields.project.key) || projectKey,
      projectName: (issue.fields.project && issue.fields.project.name) || 'Unknown',
      url: base + '/browse/' + issue.key,
      unassigned: true,
    };
  });
}

// ── Add worklog ────────────────────────────────────────────────────────────
async function addWorklog(domain, auth, issueKey, timeSpent, comment, started) {
  var base = 'https://' + domain;
  var url = base + '/rest/api/3/issue/' + issueKey + '/worklog';

  // Build ADF comment if provided
  var body = { timeSpent: timeSpent, started: started };
  if (comment && comment.trim()) {
    body.comment = {
      type: 'doc',
      version: 1,
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: comment.trim() }]
      }]
    };
  }

  return jiraPost(url, auth, body);
}
