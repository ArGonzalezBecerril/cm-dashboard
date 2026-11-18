var currentService = null, currentCluster = null, currentDisplayName = null, currentHostId = null;
var roleIntervalId = null, roleCountdownId = null, roleSecondsLeft = 30, monitoredServices = {};
var certIntervalId = null, certCountdownId = null, certSecondsLeft = 60, certMonitorActive = false;

function stopRoleMonitor() { clearInterval(roleIntervalId); clearInterval(roleCountdownId); roleIntervalId = null; roleCountdownId = null; }
function stopCertMonitor() { clearInterval(certIntervalId); clearInterval(certCountdownId); certIntervalId = null; certCountdownId = null; }

function startRoleMonitor() {
    stopRoleMonitor(); roleSecondsLeft = 30;
    var el = document.getElementById("role-sync-status");
    if (el) el.innerHTML = '<span style="color:#22d3ee;">● 30s</span>';
    roleCountdownId = setInterval(function() {
        roleSecondsLeft = roleSecondsLeft <= 1 ? 30 : roleSecondsLeft - 1;
        var s = document.getElementById("role-sync-status");
        if (s) s.innerHTML = '<span style="color:#22d3ee;">● ' + roleSecondsLeft + 's</span>';
    }, 1000);
    roleIntervalId = setInterval(function() { if (currentService && currentCluster && monitoredServices[currentService]) loadServiceRoles(true); }, 30000);
}

function toggleRoleMonitor(cb) {
    if (!currentService) return;
    monitoredServices[currentService] = cb.checked;
    if (cb.checked) startRoleMonitor();
    else { stopRoleMonitor(); var el = document.getElementById("role-sync-status"); if (el) el.textContent = "Pausado"; }
}

async function inspectHost(card) {
    document.querySelectorAll(".card-clickable").forEach(function(c) { c.classList.remove("card-selected"); });
    card.classList.add("card-selected");
    stopRoleMonitor(); stopCertMonitor(); currentService = null;
    currentHostId = card.getAttribute("data-host-id");
    var detailPanel = document.getElementById("detail-panel");
    detailPanel.innerHTML = '<div style="padding:2rem;text-align:center;color:#22d3ee;font-size:0.85rem;">Consultando radiografía del nodo...</div>';
    try {
        var res = await fetch("/api/host-detail?host_id=" + encodeURIComponent(currentHostId));
        var data = await res.json();
        if (!data.ok) { detailPanel.innerHTML = '<div class="error-box">' + data.error + '</div>'; return; }
        var h = data.host;
        var hw = '<div class="host-box"><div class="host-box-title">1. Hardware y SO</div><div class="kv-grid"><div class="kv-item"><span>SO</span><strong>' + h.os + '</strong></div><div class="kv-item"><span>RAM</span><strong>' + h.ramGb + ' GB</strong></div><div class="kv-item"><span>vCPU</span><strong>' + h.numCores + '</strong></div><div class="kv-item"><span>IP</span><strong>' + h.ipAddress + '</strong></div></div></div>';
        var roles = h.roles.map(function(r) {
            var b = r.roleState === "STARTED" ? '<span class="pill-on"><span class="dot-alive"></span> ' + r.roleState + '</span>' : '<span class="pill-off">' + r.roleState + '</span>';
            return '<div class="chk-row"><div><strong style="color:#f4f4f5;">' + r.type + '</strong> <span style="color:#71717a;font-size:0.7rem;">(' + r.service + ')</span></div><div>' + b + '</div></div>';
        }).join("");
        detailPanel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;"><h2 class="section-title" style="margin-bottom:0;">Nodo • <span>' + h.short_host + '</span></h2><span class="badge-ver">' + h.ipAddress + '</span></div>' + hw + '<div class="host-box" style="margin-bottom:0;"><div class="host-box-title">2. Roles en este Nodo (' + h.roles.length + ')</div>' + roles + '</div>';
    } catch (e) { detailPanel.innerHTML = '<div class="error-box">Error de red al consultar nodo</div>'; }
}
async function inspectService(card) {
    document.querySelectorAll(".card-clickable").forEach(function(c) { c.classList.remove("card-selected"); });
    card.classList.add("card-selected");
    stopRoleMonitor(); stopCertMonitor(); currentHostId = null;
    currentService = card.getAttribute("data-service");
    currentCluster = card.getAttribute("data-cluster");
    var nameEl = card.querySelector(".srv-name");
    currentDisplayName = nameEl ? nameEl.textContent.trim() : currentService;
    await loadServiceRoles(false);
}

async function loadServiceRoles(isSilent) {
    var detailPanel = document.getElementById("detail-panel");
    var isOn = !!monitoredServices[currentService];
    if (!isSilent) {
        detailPanel.innerHTML = '<div style="padding:2rem;text-align:center;color:#22d3ee;font-size:0.85rem;">Consultando nodos de <strong>' + currentDisplayName + '</strong>...</div>';
    }
    try {
        var res = await fetch("/api/service-roles?cluster=" + encodeURIComponent(currentCluster) + "&service=" + encodeURIComponent(currentService));
        if (res.status === 401) { window.location.href = "/login"; return; }
        var data = await res.json();
        if (!data.ok) {
            if (!isSilent) detailPanel.innerHTML = '<div class="error-box">' + data.error + '</div>';
            return;
        }

        var rolesHtml = data.roles.map(function(r) {
            var b = r.roleState === "STARTED" ? '<span class="pill-on"><span class="dot-alive"></span> ' + r.roleState + '</span>' : '<span class="pill-off">' + r.roleState + '</span>';
            var hc = r.healthSummary === "GOOD" ? "txt-green" : "txt-amber";
            return '<div class="role-item"><div><span class="role-host">' + r.hostname + '</span><span class="role-type">' + r.type + '</span></div><div style="text-align:right;">' + b + '<div style="font-size:0.7rem;color:#a1a1aa;margin-top:4px;">Salud: <span class="' + hc + '">' + r.healthSummary + '</span></div></div></div>';
        }).join("");

        // Si es refresco silencioso (30s) y ya existe la estructura, solo actualiza contenido interno sin borrar el progreso
        var existingRolesPane = document.getElementById("tab-pane-roles");
        if (isSilent && existingRolesPane) {
            existingRolesPane.innerHTML = rolesHtml;
            var cntEl = document.getElementById("service-roles-count");
            if (cntEl) cntEl.textContent = data.roles.length + " instancia(s)";
            var tabBtn = document.getElementById("tab-btn-roles");
            if (tabBtn) tabBtn.textContent = "Instancias (" + data.roles.length + ")";
            if (typeof loadServiceHistory === "function") loadServiceHistory();
            return;
        }

        var headerHtml = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;flex-wrap:wrap;gap:8px;">' +
            '<div><h2 class="section-title" style="margin-bottom:2px;">Nodos • <span>' + currentDisplayName + '</span></h2><span id="service-roles-count" style="font-size:0.72rem;color:#71717a;">' + data.roles.length + ' instancia(s)</span></div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<div class="cm-action-wrap"><button type="button" class="cm-action-btn" onclick="toggleActionMenu(event)"><span>Acciones</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg></button>' +
                '<div class="cm-action-menu" id="cm-action-dropdown"><button type="button" class="cm-menu-item" onclick="triggerServiceAction(\'start\')"><span style="color:#10b981;">▶</span> Iniciar</button><button type="button" class="cm-menu-item" onclick="triggerServiceAction(\'stop\')"><span style="color:#f43f5e;">■</span> Detener</button><button type="button" class="cm-menu-item" onclick="triggerServiceAction(\'restart\')"><span style="color:#22d3ee;">↻</span> Reiniciar</button></div></div>' +
                '<div class="live-controls"><span id="role-sync-status">' + (isOn ? '<span style="color:#22d3ee;">● 30s</span>' : 'Pausado') + '</span><label class="switch" style="margin-bottom:0;"><input type="checkbox" ' + (isOn ? 'checked' : '') + ' onchange="toggleRoleMonitor(this)"><span class="slider"></span></label><span>30s</span></div>' +
            '</div></div>';

        var tabsNav = '<div class="cm-tabs-bar">' +
            '<button type="button" class="cm-tab-btn active" id="tab-btn-roles" onclick="switchServiceTab(\'roles\')">Instancias (' + data.roles.length + ')</button>' +
            '<button type="button" class="cm-tab-btn" id="tab-btn-history" onclick="switchServiceTab(\'history\')">Historial de Acciones</button>' +
        '</div>';
        var paneRoles = '<div class="cm-tab-pane active" id="tab-pane-roles">' + rolesHtml + '</div>';
        var paneHistory = '<div class="cm-tab-pane" id="tab-pane-history"><div class="host-box" style="margin-bottom:0;"><div class="host-box-title">Bitácora de Operaciones • ' + currentDisplayName + '</div><div id="service-history-box"><div style="font-size:0.75rem;color:#71717a;">Cargando registros...</div></div></div></div>';
        var execContainer = '<div id="service-exec-container" style="margin-top:1rem;"></div>';

        detailPanel.innerHTML = headerHtml + tabsNav + paneRoles + paneHistory + execContainer;
        if (typeof loadServiceHistory === "function") loadServiceHistory();
        if (isOn && !roleIntervalId) startRoleMonitor();
    } catch (e) {
        if (!isSilent) detailPanel.innerHTML = '<div class="error-box">Error de red al consultar servicio</div>';
    }
}

function toggleCertMonitor(cb) {
    certMonitorActive = cb.checked;
    if (certMonitorActive) {
        stopCertMonitor(); certSecondsLeft = 60;
        certCountdownId = setInterval(function() { certSecondsLeft = certSecondsLeft <= 1 ? 60 : certSecondsLeft - 1; var e = document.getElementById("cert-sync-status"); if (e) e.innerHTML = '<span style="color:#22d3ee;">● ' + certSecondsLeft + 's</span>'; }, 1000);
        certIntervalId = setInterval(function() { if (certMonitorActive && document.getElementById("cert-sync-status")) loadCertificates(true); else stopCertMonitor(); }, 60000);
    } else { stopCertMonitor(); var el = document.getElementById("cert-sync-status"); if (el) el.textContent = "Pausado"; }
}

async function inspectCertificates() { document.querySelectorAll(".card-clickable").forEach(function(c) { c.classList.remove("card-selected"); }); stopRoleMonitor(); stopCertMonitor(); currentService = null; currentHostId = null; await loadCertificates(false); }

async function loadCertificates(isSilent) {
    var detailPanel = document.getElementById("detail-panel");
    if (!isSilent) detailPanel.innerHTML = '<div style="padding:2rem;text-align:center;color:#22d3ee;font-size:0.85rem;">Escaneando certificados TLS...</div>';
    try {
        var res = await fetch("/api/tls-check");
        var data = await res.json();
        if (!data.ok) { detailPanel.innerHTML = '<div class="error-box">' + data.error + '</div>'; return; }
        var cards = data.certs.map(function(c) {
            var b = c.status === "VALID" ? '<span class="pill-on"><span class="dot-alive"></span> ' + c.daysLeft + ' días</span>' : (c.status === "NO_TLS" ? '<span class="badge-ver">SIN TLS</span>' : '<span class="pill-off">' + (c.daysLeft !== null ? c.daysLeft + ' días' : 'VENCIDO') + '</span>');
            return '<div class="host-box" style="margin-bottom:0.75rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;"><strong style="color:#f4f4f5;font-size:0.85rem;">' + c.label + '</strong>' + b + '</div><div style="font-size:0.74rem;color:#a1a1aa;font-family:monospace;">Expira: <strong style="color:#e4e4e7;">' + c.expiresAt + '</strong></div></div>';
        }).join("");
        detailPanel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;"><div style="display:flex;align-items:center;gap:10px;"><h2 class="section-title" style="margin-bottom:0;">Auditoría • <span>Certificados TLS</span></h2><span class="badge-ver">' + data.certs.length + ' endpoints</span></div><div class="live-controls"><span id="cert-sync-status">' + (certMonitorActive ? '<span style="color:#22d3ee;">● 60s</span>' : 'Pausado') + '</span><label class="switch" style="margin-bottom:0;"><input type="checkbox" ' + (certMonitorActive ? 'checked' : '') + ' onchange="toggleCertMonitor(this)"><span class="slider"></span></label><span>60s</span></div></div>' + cards;
    } catch (e) {}
}

function inspectAbout() {
    document.querySelectorAll(".card-clickable").forEach(function(c) { c.classList.remove("card-selected"); }); stopRoleMonitor(); stopCertMonitor(); currentService = null; currentHostId = null;
    document.getElementById("detail-panel").innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;"><h2 class="section-title" style="margin-bottom:0;">Acerca de • <span>Sistema</span></h2><span class="pill-on">v1.0</span></div><div class="host-box"><div class="host-box-title">Tablero Cloudera API Monitor</div><p style="font-size:0.82rem;color:#d4d4d8;line-height:1.6;">Plataforma interna de observabilidad y control operativo para clústeres Cloudera sin licencia • Equipo Big Data Seguritech.</p></div>';
}

var toggle = document.getElementById("auto-refresh-toggle"), syncStatus = document.getElementById("sync-status"), intervalId = null, countdownId = null, secondsLeft = 60;
if (toggle) {
    if (localStorage.getItem("cm_auto_refresh") === "true") { toggle.checked = true; startAutoRefresh(); }
    toggle.addEventListener("change", function() { localStorage.setItem("cm_auto_refresh", toggle.checked); if (toggle.checked) startAutoRefresh(); else { clearInterval(intervalId); clearInterval(countdownId); if (syncStatus) syncStatus.textContent = "Pausado"; } });
}
function startAutoRefresh() {
    clearInterval(intervalId); clearInterval(countdownId); secondsLeft = 60;
    if (syncStatus) syncStatus.innerHTML = '<span style="color:#22d3ee;">● 60s</span>';
    countdownId = setInterval(function() { secondsLeft = secondsLeft <= 1 ? 60 : secondsLeft - 1; if (syncStatus) syncStatus.innerHTML = '<span style="color:#22d3ee;">● ' + secondsLeft + 's</span>'; }, 1000);
    intervalId = setInterval(async function() {
        var res = await fetch("/api/live-status"); if (res.status === 401) { window.location.href = "/login"; return; }
        var p = await res.json(); if (!p.ok) return;
        document.getElementById("nodes-count").textContent = p.hosts.length;
        document.getElementById("nodes-container").innerHTML = p.hosts.map(function(h) {
            var pill = h.is_alive ? '<span class="pill-on"><span class="dot-alive"></span> ON</span>' : '<span class="pill-off"><span class="dot-dead"></span> DEAD</span>';
            var ram = (h.totalPhysMemBytes / (1024 * 1024 * 1024)).toFixed(1);
            return '<div class="card card-clickable ' + (h.is_alive ? 'card-alive' : 'card-dead') + (h.hostId === currentHostId ? ' card-selected' : '') + '" data-host-id="' + h.hostId + '" onclick="inspectHost(this)"><div class="card-top"><span class="ip">' + h.ipAddress + '</span>' + pill + '</div><div class="hostname">' + h.hostname + '</div><div class="specs"><span>CPU: <strong>' + h.numCores + 'c</strong></span><span>RAM: <strong>' + ram + 'G</strong></span><span>HB: <strong>' + (h.hb_seconds !== null ? h.hb_seconds + 's' : '?') + '</strong></span></div></div>';
        }).join("");
    }, 60000);
}
