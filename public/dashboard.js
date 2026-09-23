/* Live updates for the dashboard and the projector wall.
   One SSE connection; the server pushes tickets, stats and the MARS session
   census as they change. Everything here degrades to "the page still works,
   you just have to refresh it". */

(function () {
  'use strict';

  var MAX_CARDS = window.WALL_MODE ? 24 : 12;

  var cards = document.getElementById('cards');
  var dot = document.getElementById('livedot');
  var dotText = document.getElementById('livetext');

  function setLive(on, label) {
    if (!dot) return;
    dot.classList.toggle('live', !!on);
    if (dotText) dotText.textContent = label;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderCard(t) {
    var sev = esc(t.severity);
    var el = document.createElement('article');
    el.className = 'card';
    el.style.setProperty('--sev', 'var(--' + sev.toLowerCase() + ')');
    el.innerHTML =
      '<div class="card-top">' +
        '<span class="sev ' + sev + '">' + sev + '</span>' +
        '<span class="chip">' + esc(t.component) + '</span>' +
        '<span class="chip">' + esc(t.suggested_owner) + '</span>' +
      '</div>' +
      '<h3>' + esc(t.title) + '</h3>' +
      (t.complaint_body ? '<p class="quote">“' + esc(t.complaint_body) + '”</p>' : '') +
      '<p class="rc"><b>Root cause hypothesis</b>' + esc(t.root_cause_hypothesis) + '</p>' +
      '<div class="card-foot">' +
        '<span>' + esc(t.affected_users) + ' affected</span>' +
        '<span>SLA ' + esc(t.sla_hours) + 'h</span>' +
        '<span>#' + esc(t.id) + '</span>' +
      '</div>';
    return el;
  }

  function addTicket(t) {
    if (!cards) return;

    // Guard against a double delivery putting the same ticket up twice.
    if (cards.querySelector('[data-ticket="' + t.id + '"]')) return;

    var empty = document.getElementById('empty');
    if (empty) empty.remove();

    var el = renderCard(t);
    el.setAttribute('data-ticket', t.id);
    cards.insertBefore(el, cards.firstChild);

    while (cards.children.length > MAX_CARDS) {
      cards.removeChild(cards.lastChild);
    }
  }

  function setStat(name, value) {
    var nodes = document.querySelectorAll('[data-stat="' + name + '"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].textContent !== String(value)) nodes[i].textContent = value;
    }
  }

  function applyStats(s) {
    setStat('tickets', s.tickets);
    setStat('complaints', s.complaints);
    setStat('processing', s.processing);
    setStat('failed', s.failed);
    renderBreakdown(s.byComponent);
  }

  function renderBreakdown(rows) {
    var table = document.getElementById('by-component');
    if (!table || !rows) return;

    var body = table.querySelector('tbody');
    if (!body) return;

    var max = 1;
    for (var i = 0; i < rows.length; i++) max = Math.max(max, rows[i].count);

    body.innerHTML = rows.length
      ? rows
          .map(function (c) {
            var pct = Math.round((c.count / max) * 100);
            return (
              '<tr><td>' + esc(c.component) + '</td>' +
              '<td class="num">' + c.count + '</td>' +
              '<td><div class="bar" style="width:' + pct + '%"></div></td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="3" class="muted">No data yet.</td></tr>';
  }

  function applySessions(s) {
    var total = document.getElementById('sessions-total');
    var sub = document.getElementById('sessions-sub');
    if (total) total.textContent = s.total;
    if (sub) sub.textContent = s.running + ' running · ' + s.paused + ' paused';
  }

  var retry = 1000;
  var source = null;

  function connect() {
    source = new EventSource('/api/stream');

    source.addEventListener('open', function () {
      retry = 1000;
      setLive(true, 'live');
    });

    source.addEventListener('ticket', function (e) {
      try { addTicket(JSON.parse(e.data)); } catch (_) {}
    });

    source.addEventListener('stats', function (e) {
      try { applyStats(JSON.parse(e.data)); } catch (_) {}
    });

    source.addEventListener('sessions', function (e) {
      try { applySessions(JSON.parse(e.data)); } catch (_) {}
    });

    source.addEventListener('summary', function () {
      // A new executive summary is the finale — just reload so it renders in full.
      if (!window.WALL_MODE) window.location.reload();
    });

    source.addEventListener('error', function () {
      setLive(false, 'reconnecting');
      source.close();
      // Back off to 15s, so a server restart mid-talk recovers quietly.
      retry = Math.min(retry * 2, 15000);
      setTimeout(connect, retry);
    });
  }

  // Tag the server-rendered cards so SSE re-delivery cannot duplicate them.
  if (cards) {
    var initial = cards.querySelectorAll('.card');
    for (var i = 0; i < initial.length; i++) {
      var foot = initial[i].querySelector('.card-foot span:last-child');
      if (foot) initial[i].setAttribute('data-ticket', foot.textContent.replace('#', '').trim());
    }
  }

  connect();
})();
