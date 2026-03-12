// ── State ──────────────────────────────────────────────────────────────────
var state = {
  config: null, projects: [], tasks: [],
  selectedProject: null, activeFilter: 'all', lastSync: null,
  currentTicket: null,
};

// ── DOM ────────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
var content = $('content');

function setStatus(online, text, syncTime) {
  $('statusDot').className = 'status-dot' + (online ? '' : ' offline');
  $('statusText').textContent = text;
  $('lastSync').textContent = syncTime || '';
}

function showBreadcrumb(project, ticketKey) {
  var bc = $('breadcrumb');
  if (!project) { bc.className = 'breadcrumb'; return; }
  bc.className = 'breadcrumb visible';
  $('bc-project').textContent = project;
  if (ticketKey) {
    $('bc-sep2').style.display = ''; $('bc-ticket').style.display = '';
    $('bc-ticket').textContent = ticketKey;
  } else {
    $('bc-sep2').style.display = 'none'; $('bc-ticket').style.display = 'none';
  }
}

function showFilterBar(show) { $('filterBar').className = 'filter-bar' + (show ? ' visible' : ''); }

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Filter helpers ─────────────────────────────────────────────────────────
var STATUS_FILTER_MAP = {
  'inprogress': ['In Progress','In Review','Review','In Development'],
  'todo': ['To Do','Open','Backlog','Reopened'],
  'done': ['Done','Closed','Resolved','Complete','Completed'],
};

function matchesFilter(task, filter) {
  if (filter === 'all') return true;
  var allowed = STATUS_FILTER_MAP[filter] || [];
  if (allowed.indexOf(task.status) !== -1) return true;
  if (filter === 'inprogress' && task.statusCategory === 'indeterminate') return true;
  if (filter === 'todo' && task.statusCategory === 'new') return true;
  if (filter === 'done' && task.statusCategory === 'done') return true;
  return false;
}

function updateFilterCounts(tasks) {
  $('fc-all').textContent = tasks.length;
  $('fc-inprogress').textContent = tasks.filter(function(t){ return matchesFilter(t,'inprogress'); }).length;
  $('fc-todo').textContent = tasks.filter(function(t){ return matchesFilter(t,'todo'); }).length;
  $('fc-done').textContent = tasks.filter(function(t){ return matchesFilter(t,'done'); }).length;
}

function setActiveFilter(filter) {
  state.activeFilter = filter;
  ['all','inprogress','todo','done'].forEach(function(f) {
    var btn = $('f-' + f);
    btn.className = 'filter-btn' + (f === filter ? (f === 'all' ? ' active' : ' active-' + f) : '');
  });
  renderTasks(state.selectedProject);
}

// ── API ────────────────────────────────────────────────────────────────────
function bgSend(msg) {
  return new Promise(function(resolve, reject) {
    chrome.runtime.sendMessage(msg, function(response) {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!response) { reject(new Error('No response from background.')); return; }
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error));
    });
  });
}

function getAuth() { return btoa(state.config.email + ':' + state.config.token); }
function getDomain() { return state.config.domain.trim().replace(/^https?:\/\//i,'').replace(/\/+$/,'').toLowerCase(); }

// ── Render: Loader ─────────────────────────────────────────────────────────
function renderLoader(msg) {
  content.innerHTML = '<div class="loader"><div class="spinner"></div><div class="loader-text">' + esc(msg || 'Loading...') + '</div></div>';
}

// ── Render: Setup ──────────────────────────────────────────────────────────
function renderSetup(errorMsg) {
  showBreadcrumb(null); showFilterBar(false); setStatus(false, 'Not connected');
  content.innerHTML =
    '<div class="settings-panel">' +
      '<div style="padding:2px 0 8px"><div style="font-size:15px;font-weight:800;margin-bottom:4px">Connect to Jira</div>' +
      '<div style="font-size:11px;color:var(--muted);line-height:1.6">Stored locally in Chrome only.</div></div>' +
      '<div class="field-group"><div class="field-label">Jira Domain</div>' +
        '<input class="field-input" id="inp-domain" placeholder="yourcompany.atlassian.net" />' +
        '<div class="field-hint">Must end in .atlassian.net</div></div>' +
      '<div class="field-group"><div class="field-label">Email</div>' +
        '<input class="field-input" id="inp-email" type="email" placeholder="you@company.com" /></div>' +
      '<div class="field-group"><div class="field-label">API Token</div>' +
        '<input class="field-input" id="inp-token" type="password" placeholder="Paste your API token" />' +
        '<div class="field-hint"><a href="#" id="tokenLink">&#8599; Generate at Atlassian</a></div></div>' +
      (errorMsg ? '<div class="error-banner">&#9888; ' + esc(errorMsg) + '</div>' : '') +
      '<button class="btn-primary" id="saveBtn">Connect &amp; Load Tasks</button>' +
    '</div>';
  $('tokenLink').addEventListener('click', function(e) { e.preventDefault(); chrome.tabs.create({ url: 'https://id.atlassian.com/manage-profile/security/api-tokens' }); });
  $('saveBtn').addEventListener('click', saveConfig);
}

// ── Render: Projects ───────────────────────────────────────────────────────
function renderProjects(errorMsg) {
  showBreadcrumb(null); showFilterBar(false);
  var total = state.projects.reduce(function(a,p){ return a+p.count; }, 0);
  setStatus(!errorMsg, errorMsg ? 'Offline \u2014 cached' : total + ' task' + (total!==1?'s':'') + ' assigned', state.lastSync);
  var html = errorMsg ? '<div class="error-banner">&#9888; ' + esc(errorMsg) + '</div>' : '';
  if (!state.projects.length) {
    html += '<div class="empty-state"><div class="empty-icon">&#127881;</div><div class="empty-text">No assigned tasks.<br>You\'re all caught up!</div></div>';
    content.innerHTML = html; return;
  }
  var colors = [['#4f7cff','#1a2040'],['#7c5cff','#1e1640'],['#3ecf8e','#0d2820'],['#f5a623','#2a1e0a'],['#ff5c5c','#2a0f0f'],['#00d4ff','#001a2a'],['#ff7eb3','#2a0f1a'],['#a8ff3e','#1a2a0a']];
  html += '<div class="section-label">Your Projects</div>';
  state.projects.forEach(function(p, i) {
    var fg=colors[i%colors.length][0], bg=colors[i%colors.length][1];
    var initials = p.name.split(' ').map(function(w){ return w[0]||''; }).join('').slice(0,2).toUpperCase();
    html += '<div class="project-card" data-key="' + esc(p.key) + '">' +
      '<div class="project-avatar" style="background:' + bg + ';color:' + fg + ';border:1.5px solid ' + fg + '30">' + initials + '</div>' +
      '<div class="project-info"><div class="project-name">' + esc(p.name) + '</div><div class="project-meta">' + esc(p.key) + '</div></div>' +
      '<div class="project-count">' + p.count + '</div><div class="chevron">&#8250;</div></div>';
  });
  content.innerHTML = html;
  content.querySelectorAll('.project-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var project = state.projects.find(function(p){ return p.key === card.dataset.key; });
      if (project) { state.selectedProject = project; state.activeFilter = 'all'; renderTasks(project); }
    });
  });
}

// ── Render: Tasks ──────────────────────────────────────────────────────────
function renderTasks(project) {
  showBreadcrumb(project.name, null); showFilterBar(true);
  var allTasks = state.tasks.filter(function(t){ return t.projectKey === project.key; });
  updateFilterCounts(allTasks);
  var tasks = allTasks.filter(function(t){ return matchesFilter(t, state.activeFilter); });
  setStatus(true, tasks.length + ' task' + (tasks.length!==1?'s':'') + ' \u2014 ' + project.key);
  if (!tasks.length) { content.innerHTML = '<div class="no-tasks">No tasks match this filter.</div>'; return; }
  var statusMap = {'To Do':'todo','In Progress':'inprogress','Done':'done','In Review':'review','Review':'review','Closed':'done','Resolved':'done'};
  var priorityMap = {'High':'high','Highest':'high','Medium':'medium','Low':'low','Lowest':'low'};
  var html = '<div class="section-label">' + esc(project.name) + ' &mdash; ' + tasks.length + ' task' + (tasks.length!==1?'s':'') + '</div>';
  tasks.forEach(function(t) {
    var sc = statusMap[t.status]||'todo', pc = priorityMap[t.priority]||'medium';
    html += '<div class="task-item" data-key="' + esc(t.key) + '">' +
      '<div class="task-top"><span class="task-key">' + esc(t.key) + '</span><div class="task-title">' + esc(t.summary) + '</div></div>' +
      '<div class="task-bottom"><span class="badge badge-status-' + sc + '">' + esc(t.status) + '</span>' +
      '<span class="badge badge-priority-' + pc + '">&#8593; ' + esc(t.priority) + '</span>' +
      '<span class="badge badge-type">' + esc(t.type) + '</span></div></div>';
  });
  content.innerHTML = html;
  content.querySelectorAll('.task-item').forEach(function(item) {
    item.addEventListener('click', function() { renderTicketDetail(item.dataset.key); });
  });
}

// ── Render: Ticket Detail ──────────────────────────────────────────────────
function renderTicketDetail(issueKey) {
  showBreadcrumb(state.selectedProject ? state.selectedProject.name : '', issueKey);
  showFilterBar(false);
  setStatus(true, 'Loading ' + issueKey + '...');
  renderLoader('Loading ' + issueKey + '...');

  bgSend({ type: 'JIRA_FETCH_TICKET', domain: getDomain(), auth: getAuth(), issueKey: issueKey })
    .then(function(t) {
      state.currentTicket = t;
      bgSend({ type: 'JIRA_FETCH_WORKLOGS', domain: getDomain(), auth: getAuth(), issueKey: issueKey })
        .then(function(wl) { renderTicketData(t, wl.worklogs || []); })
        .catch(function() { renderTicketData(t, []); });
    })
    .catch(function(err) {
      content.innerHTML = '<div class="error-banner">&#9888; ' + esc(err.message) + '</div>';
    });
}

function renderTicketData(t, worklogs) {
  setStatus(true, t.key + ' \u2014 ' + t.project);
  var statusMap = {'To Do':'todo','In Progress':'inprogress','Done':'done','In Review':'review','Review':'review','Closed':'done','Resolved':'done'};
  var priorityMap = {'High':'high','Highest':'high','Medium':'medium','Low':'low','Lowest':'low'};
  var sc = statusMap[t.status]||'todo', pc = priorityMap[t.priority]||'medium';

  var html = '<div class="detail-scroll">';

  // Header
  html += '<div style="margin-bottom:10px">' +
    '<div class="detail-key-row"><span class="task-key" style="font-size:11px;padding:2px 7px">' + esc(t.key) + '</span>' +
    '<span class="badge badge-type">' + esc(t.type) + '</span>' +
    (t.parent ? '<span class="badge badge-label">&#8657; ' + esc(t.parent.key) + '</span>' : '') +
    '</div>' +
    '<div class="detail-title">' + esc(t.summary) + '</div>' +
    '<div class="detail-badges"><span class="badge badge-status-' + sc + '">' + esc(t.status) + '</span>' +
    '<span class="badge badge-priority-' + pc + '">&#8593; ' + esc(t.priority) + '</span>' +
    t.labels.map(function(l){ return '<span class="badge badge-label">' + esc(l) + '</span>'; }).join('') +
    t.components.map(function(c){ return '<span class="badge badge-type">' + esc(c) + '</span>'; }).join('') +
    '</div></div>';

  // Meta grid
  html += '<div class="detail-grid">' +
    detailField('Assignee', t.assignee) + detailField('Reporter', t.reporter) +
    detailField('Created', fmtDate(t.created)) + detailField('Updated', fmtDate(t.updated)) +
    (t.duedate ? detailField('Due Date', fmtDate(t.duedate)) : '') +
    detailField('Project', t.project) + '</div>';

  // Time tracking
  var tt = t.timetracking || {};
  if (tt.originalEstimate || tt.timeSpent) {
    html += '<div class="detail-section"><div class="detail-section-title">Time Tracking</div>';
    html += '<div class="time-track-bar-wrap">';
    html += '<div class="time-track-row">' +
      '<span>Estimated</span><span>' + esc(tt.originalEstimate || 'Not set') + '</span></div>' +
      '<div class="time-track-row"><span>Logged</span><span style="color:var(--success)">' + esc(tt.timeSpent || '0m') + '</span></div>' +
      (tt.remainingEstimate ? '<div class="time-track-row"><span>Remaining</span><span style="color:var(--warn)">' + esc(tt.remainingEstimate) + '</span></div>' : '');
    // Progress bar
    if (tt.originalEstimateSeconds && tt.timeSpentSeconds) {
      var pct = Math.min(100, Math.round((tt.timeSpentSeconds / tt.originalEstimateSeconds) * 100));
      html += '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>';
    }
    html += '</div></div>';
  }

  // Worklog section
  html += '<div class="detail-section" id="worklog-section">' +
    '<div class="detail-section-title">Work Log' +
    '<button class="log-time-btn" id="openWorklogBtn">&#43; Log Time</button>' +
    '</div>';
  if (worklogs.length === 0) {
    html += '<div style="font-size:11px;color:var(--muted);padding:4px 0">No worklogs yet.</div>';
  } else {
    worklogs.forEach(function(w) {
      html += '<div class="worklog-item">' +
        '<div class="worklog-meta">' +
          '<span class="worklog-author">' + esc(w.author) + '</span>' +
          '<span class="worklog-time">&#9201; ' + esc(w.timeSpent) + '</span>' +
        '</div>' +
        '<div class="worklog-date">' + fmtDate(w.started) + '</div>' +
        (w.comment ? '<div class="worklog-comment">' + esc(w.comment.slice(0,120)) + '</div>' : '') +
      '</div>';
    });
  }
  html += '</div>';

  // Description
  if (t.description && t.description.trim()) {
    html += '<div class="detail-section"><div class="detail-section-title">Description</div>' +
      '<div class="detail-description">' + esc(t.description.trim()) + '</div></div>';
  }

  // Subtasks
  if (t.subtasks && t.subtasks.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Subtasks (' + t.subtasks.length + ')</div>';
    t.subtasks.forEach(function(s) {
      var ssc = statusMap[s.status]||'todo';
      html += '<div class="subtask-item"><span class="task-key">' + esc(s.key) + '</span>' +
        '<span class="subtask-title">' + esc(s.summary) + '</span>' +
        '<span class="badge badge-status-' + ssc + '" style="font-size:9px">' + esc(s.status||'') + '</span></div>';
    });
    html += '</div>';
  }

  // Comments
  if (t.comments && t.comments.length) {
    html += '<div class="detail-section"><div class="detail-section-title">Recent Comments</div>';
    t.comments.forEach(function(c) {
      html += '<div class="comment-item"><div class="comment-meta"><span class="comment-author">' + esc(c.author) + '</span>' +
        '<span class="comment-date">' + fmtDate(c.created) + '</span></div>' +
        '<div class="comment-body">' + esc(c.body.trim().slice(0,300)) + (c.body.length>300?'...':'') + '</div></div>';
    });
    html += '</div>';
  }

  html += '<button class="detail-open-btn" id="openJiraBtn">&#8599; Open in Jira</button>';
  html += '</div>';
  content.innerHTML = html;

  $('openJiraBtn').addEventListener('click', function() { chrome.tabs.create({ url: t.url }); });
  $('openWorklogBtn').addEventListener('click', function() { openWorklogModal(t.key); });
}

function detailField(label, value) {
  return '<div class="detail-field"><div class="detail-field-label">' + esc(label) + '</div><div class="detail-field-value">' + esc(value||'N/A') + '</div></div>';
}

// ── Worklog Modal ──────────────────────────────────────────────────────────
function openWorklogModal(issueKey) {
  // Build today's date in Jira format: 2024-06-15T09:00:00.000+0000
  var now = new Date();
  var pad = function(n){ return String(n).padStart(2,'0'); };
  var todayVal = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate());

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'worklogOverlay';
  overlay.innerHTML =
    '<div class="modal">' +
      '<div class="modal-title">&#9201; Log Work</div>' +
      '<div class="modal-subtitle">' + esc(issueKey) + '</div>' +
      '<div class="modal-fields">' +
        '<div>' +
          '<div class="modal-field-label">Time Spent *</div>' +
          '<input class="modal-input" id="wl-time" placeholder="e.g. 2h 30m, 1d, 45m" />' +
          '<div class="time-presets">' +
            '<span class="time-preset" data-val="30m">30m</span>' +
            '<span class="time-preset" data-val="1h">1h</span>' +
            '<span class="time-preset" data-val="2h">2h</span>' +
            '<span class="time-preset" data-val="4h">4h</span>' +
            '<span class="time-preset" data-val="1d">1d</span>' +
          '</div>' +
          '<div class="modal-hint">Formats: 2h, 30m, 1d, 1h 30m</div>' +
        '</div>' +
        '<div>' +
          '<div class="modal-field-label">Date</div>' +
          '<input class="modal-input" id="wl-date" type="date" value="' + todayVal + '" />' +
        '</div>' +
        '<div>' +
          '<div class="modal-field-label">Comment (optional)</div>' +
          '<input class="modal-input" id="wl-comment" placeholder="What did you work on?" />' +
        '</div>' +
      '</div>' +
      '<div id="wl-error" class="modal-error"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn-secondary" id="wl-cancel">Cancel</button>' +
        '<button class="btn-primary" id="wl-submit">&#10003; Log Time</button>' +
      '</div>' +
    '</div>';

  document.getElementById('app').appendChild(overlay);

  // Preset buttons
  overlay.querySelectorAll('.time-preset').forEach(function(btn) {
    btn.addEventListener('click', function() {
      $('wl-time').value = btn.dataset.val;
      $('wl-time').focus();
    });
  });

  $('wl-cancel').addEventListener('click', closeWorklogModal);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeWorklogModal(); });

  $('wl-submit').addEventListener('click', function() {
    var timeSpent = $('wl-time').value.trim();
    var comment = $('wl-comment').value.trim();
    var dateVal = $('wl-date').value;
    var errEl = $('wl-error');

    if (!timeSpent) { errEl.textContent = 'Time spent is required.'; return; }
    if (!isValidTime(timeSpent)) { errEl.textContent = 'Invalid format. Use: 2h, 30m, 1d, 1h 30m'; return; }

    // Convert date to Jira started format
    var started = dateVal ? dateVal + 'T09:00:00.000+0000' : new Date().toISOString().replace('Z','+0000').slice(0,23) + '+0000';

    var btn = $('wl-submit');
    btn.disabled = true; btn.textContent = 'Logging...';
    errEl.textContent = '';

    bgSend({
      type: 'JIRA_ADD_WORKLOG',
      domain: getDomain(),
      auth: getAuth(),
      issueKey: issueKey,
      timeSpent: timeSpent,
      comment: comment,
      started: started,
    }).then(function() {
      // Show success then reload ticket
      errEl.className = 'modal-success';
      errEl.textContent = '&#10003; Logged ' + timeSpent + ' successfully!';
      setTimeout(function() {
        closeWorklogModal();
        renderTicketDetail(issueKey);
      }, 1200);
    }).catch(function(err) {
      btn.disabled = false; btn.textContent = '&#10003; Log Time';
      errEl.className = 'modal-error';
      errEl.textContent = err.message;
    });
  });

  // Focus time input
  setTimeout(function() { var el = $('wl-time'); if (el) el.focus(); }, 100);
}

function closeWorklogModal() {
  var overlay = $('worklogOverlay');
  if (overlay) overlay.remove();
}

function isValidTime(str) {
  // Accept formats: 2h, 30m, 1d, 2h 30m, 1d 4h, etc.
  return /^(\d+[wdhm]\s*)+$/i.test(str.trim());
}

// ── Render: Settings ───────────────────────────────────────────────────────
function renderSettings() {
  showBreadcrumb(null); showFilterBar(false); setStatus(false, 'Settings');
  var cfg = state.config || {};
  var html = '<div class="settings-panel">' +
    '<div style="font-size:14px;font-weight:800;padding:2px 0 8px">Settings</div>' +
    '<div class="field-group"><div class="field-label">Jira Domain</div>' +
      '<input class="field-input" id="inp-domain" value="' + esc(cfg.domain||'') + '" />' +
      '<div class="field-hint">e.g. yourcompany.atlassian.net</div></div>' +
    '<div class="field-group"><div class="field-label">Email</div>' +
      '<input class="field-input" id="inp-email" type="email" value="' + esc(cfg.email||'') + '" /></div>' +
    '<div class="field-group"><div class="field-label">API Token</div>' +
      '<input class="field-input" id="inp-token" type="password" placeholder="Leave blank to keep existing" /></div>' +
    '<div id="setup-error"></div>' +
    '<button class="btn-primary" id="saveBtn">Save &amp; Reconnect</button>';
  if (state.config) html += '<button class="icon-btn" id="cancelBtn" style="width:100%;height:32px;font-size:12px;margin-top:-4px">&#8592; Back</button>';
  html += '</div>';
  content.innerHTML = html;
  $('saveBtn').addEventListener('click', saveConfig);
  var cb = $('cancelBtn');
  if (cb) cb.addEventListener('click', function() { if (state.selectedProject) renderTasks(state.selectedProject); else renderProjects(); });
}

// ── Actions ────────────────────────────────────────────────────────────────
function loadTasks(config) {
  renderLoader('Fetching tasks...');
  var domain = config.domain.trim().replace(/^https?:\/\//i,'').replace(/\/+$/,'').toLowerCase();
  var auth = btoa(config.email + ':' + config.token);
  bgSend({ type: 'JIRA_FETCH_TASKS', domain: domain, auth: auth })
    .then(function(result) {
      state.tasks = result.tasks; state.projects = result.projects;
      state.lastSync = 'Synced ' + new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      chrome.storage.local.set({ cachedTasks: state.tasks, cachedProjects: state.projects, lastSync: state.lastSync });
      renderProjects();
    })
    .catch(function(err) {
      chrome.storage.local.get(['cachedTasks','cachedProjects','lastSync'], function(cached) {
        if (cached.cachedProjects && cached.cachedProjects.length) {
          state.tasks = cached.cachedTasks || []; state.projects = cached.cachedProjects || [];
          state.lastSync = cached.lastSync || ''; renderProjects(err.message);
        } else {
          setStatus(false, 'Connection failed');
          content.innerHTML = '<div class="error-banner">&#9888; ' + esc(err.message) + '</div>';
        }
      });
    });
}

function saveConfig() {
  var rawDomain = ($('inp-domain') && $('inp-domain').value.trim()) || '';
  var email = ($('inp-email') && $('inp-email').value.trim()) || '';
  var tokenInput = ($('inp-token') && $('inp-token').value.trim()) || '';
  var errEl = $('setup-error');
  if (!rawDomain || !email) { if (errEl) errEl.innerHTML = '<div class="error-banner">Please fill in all fields.</div>'; return; }
  var domain = rawDomain.replace(/^https?:\/\//i,'').replace(/\/+$/,'').trim().toLowerCase();
  if (!domain.endsWith('.atlassian.net')) { if (errEl) errEl.innerHTML = '<div class="error-banner">Domain must end in .atlassian.net</div>'; return; }
  var token = tokenInput || (state.config && state.config.token) || '';
  if (!token) { if (errEl) errEl.innerHTML = '<div class="error-banner">API token is required.</div>'; return; }
  var config = { domain: domain, email: email, token: token };
  state.config = config;
  chrome.storage.local.set({ jiraConfig: config });
  loadTasks(config);
}

// ── Buttons ────────────────────────────────────────────────────────────────
['all','inprogress','todo','done'].forEach(function(f) {
  $('f-' + f).addEventListener('click', function() { setActiveFilter(f); });
});

$('settingsBtn').addEventListener('click', function() {
  if (content.querySelector('.settings-panel')) {
    if (state.config) { if (state.selectedProject) renderTasks(state.selectedProject); else renderProjects(); }
  } else { renderSettings(); }
});

$('refreshBtn').addEventListener('click', function() {
  if (!state.config) return;
  var btn = $('refreshBtn');
  btn.classList.add('refresh-spin');
  setTimeout(function(){ btn.classList.remove('refresh-spin'); }, 700);
  state.selectedProject = null; loadTasks(state.config);
});

$('bc-home').addEventListener('click', function() { state.selectedProject = null; state.activeFilter = 'all'; renderProjects(); });
$('bc-project').addEventListener('click', function() { if (state.selectedProject) { state.activeFilter = 'all'; renderTasks(state.selectedProject); } });

// ── Boot ───────────────────────────────────────────────────────────────────
chrome.storage.local.get(['jiraConfig','cachedTasks','cachedProjects','lastSync'], function(result) {
  if (result.jiraConfig) {
    state.config = result.jiraConfig;
    if (result.cachedProjects && result.cachedProjects.length) {
      state.tasks = result.cachedTasks || []; state.projects = result.cachedProjects || [];
      state.lastSync = result.lastSync || ''; renderProjects();
    }
    loadTasks(state.config);
  } else { renderSetup(); }
});
