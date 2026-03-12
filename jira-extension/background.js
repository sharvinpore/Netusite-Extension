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
});

async function jiraGet(url, auth) {
  var res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' }
    });
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
  if (!res.ok) {
    var detail = '';
    try { var j = await res.json(); detail = j.message || (j.errorMessages && j.errorMessages[0]) || ''; } catch(_) {}
    if (res.status === 401) throw new Error('Invalid credentials — check your email and API token.');
    if (res.status === 403) throw new Error('Access denied — your token may lack permissions.');
    if (res.status === 404) throw new Error('Not found — check your Jira domain.');
    if (res.status === 429) throw new Error('Rate limited — please wait and try again.');
    throw new Error('Jira API error ' + res.status + (detail ? ': ' + detail : ''));
  }
  return res.json();
}

async function fetchAllTasks(domain, auth) {
  var base = 'https://' + domain;
  await jiraGet(base + '/rest/api/3/myself', auth);

  var jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
  var url = base + '/rest/api/3/search/jql'
    + '?jql=' + encodeURIComponent(jql)
    + '&maxResults=100'
    + '&fields=summary,status,priority,issuetype,project';

  var data = await jiraGet(url, auth);

  var tasks = (data.issues || []).map(function(issue) {
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

  return {
    tasks: tasks,
    projects: Object.values(projectMap).sort(function(a, b) { return b.count - a.count; }),
  };
}

async function fetchTicketDetail(domain, auth, issueKey) {
  var base = 'https://' + domain;
  var fields = 'summary,status,priority,issuetype,project,assignee,reporter,description,comment,created,updated,duedate,labels,components,subtasks,parent';
  var data = await jiraGet(base + '/rest/api/3/issue/' + issueKey + '?fields=' + fields, auth);

  // Extract plain text from Atlassian Document Format description
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
    url: base + '/browse/' + data.key,
  };
}
