var currentService = null;
var currentCluster = null;
var currentDisplayName = null;
var currentHostId = null;
var roleIntervalId = null;
var roleCountdownId = null;
var roleSecondsLeft = 30;
var monitoredServices = {};

function stopRoleMonitor() {
    clearInterval(roleIntervalId);
    clearInterval(roleCountdownId);
    roleIntervalId = null;
    roleCountdownId = null;
}

function startRoleMonitor() {
    stopRoleMonitor();
    roleSecondsLeft = 30;
    var statusEl = document.getElementById("role-sync-status");
    if (statusEl) statusEl.innerHTML = '<span style="color:#22d3ee;">● ' + roleSecondsLeft + 's</span>';

    roleCountdownId = setInterval(function() {
        roleSecondsLeft--;
        if (roleSecondsLeft <= 0) roleSecondsLeft = 30;
        var el = document.getElementById("role-sync-status");
        if (el) el.innerHTML = '<span style="color:#22d3ee;">● ' + roleSecondsLeft + 's</span>';
    }, 1000);

    roleIntervalId = setInterval(function() {
        if (currentService && currentCluster && monitoredServices[currentService]) {
            loadServiceRoles(true);
        }
    }, 30000);
}

function toggleRoleMonitor(checkbox) {
    if (!currentService) return;
    monitoredServices[currentService] = checkbox.checked;
    if (checkbox.checked) {
        startRoleMonitor();
    } else {
        stopRoleMonitor();
        var el = document.getElementById("role-sync-status");
        if (el) el.textContent = "Pausado";
    }
}

async function inspectHost(card) {
    document.querySelectorAll(".card-clickable").forEach(function(c) {
        c.classList.remove("card-selected");
    });
    card.classList.add("card-selected");

    stopRoleMonitor();
    currentService = null;
    currentHostId = card.getAttribute("data-host-id");
    var hostTitle = card.querySelector(".hostname") ? card.querySelector(".hostname").textContent.trim() : currentHostId;
    var detailPanel = document.getElementById("detail-panel");

    detailPanel.innerHTML = '<div style="padding:2rem;text-align:center;color:#22d3ee;font-size:0.85rem;">Consultando radiografía de <strong>' + hostTitle + '</strong>...</div>';

    try {
        var res = await fetch("/api/host-detail?host_id=" + encodeURIComponent(currentHostId));
        var data = await res.json();
        if (!data.ok) {
            detailPanel.innerHTML = '<div class="error-box"><strong>Error:</strong> ' + data.error + '</div>';
            return;
        }

        var h = data.host;
        var maintTxt = h.maintenanceMode ? '<span class="txt-amber">SI</span>' : '<span class="txt-green">NO</span>';

        // 1. Hardware y SO
        var hwHtml = '<div class="host-box"><div class="host-box-title">1. Hardware y Sistema Operativo</div>' +
            '<div class="kv-grid">' +
                '<div class="kv-item"><span>Sistema Operativo</span><strong>' + h.os + '</strong></div>' +
                '<div class="kv-item"><span>Memoria RAM</span><strong>' + h.ramGb + ' GB</strong></div>' +
                '<div class="kv-item"><span>Cores Lógicos</span><strong>' + h.numCores + ' vCPU</strong></div>' +
                '<div class="kv-item"><span>Cores Físicos</span><strong>' + (h.numPhysicalCores || h.numCores) + '</strong></div>' +
            '</div></div>';

        // 2. Red y Latidos
        var netHtml = '<div class="host-box"><div class="host-box-title">2. Red y Latidos (Heartbeat)</div>' +
            '<div class="kv-grid">' +
                '<div class="kv-item"><span>FQDN</span><strong>' + h.hostname + '</strong></div>' +
                '<div class="kv-item"><span>Dirección IP</span><strong>' + h.ipAddress + '</strong></div>' +
                '<div class="kv-item"><span>Rack / Mantenimiento</span><strong>' + h.rackId + ' • ' + maintTxt + '</strong></div>' +
                '<div class="kv-item"><span>Último Heartbeat</span><strong>' + h.lastHeartbeat + '</strong></div>' +
            '</div></div>';

        // 3. Roles y Servicios corriendo en ese nodo
        var rolesList = h.roles.length === 0
            ? '<div style="font-size:0.78rem;color:#71717a;">Sin roles asignados a este nodo.</div>'
            : h.roles.map(function(r) {
                var badge = r.roleState === "STARTED"
                    ? '<span class="pill-on"><span class="dot-alive"></span> ' + r.roleState + '</span>'
                    : (r.roleState === "NA" ? '<span class="badge-ver">NA</span>' : '<span class="pill-off"><span class="dot-dead"></span> ' + r.roleState + '</span>');
                return '<div class="chk-row"><div><strong style="color:#f4f4f5;">' + r.type + '</strong> <span style="color:#71717a;font-size:0.7rem;">(' + r.service + ')</span></div><div>' + badge + '</div></div>';
            }).join("");

        var rolesHtml = '<div class="host-box"><div class="host-box-title">3. Roles y Servicios en este Nodo (' + h.roles.length + ')</div>' + rolesList + '</div>';

        // 4. Chequeos de Salud del Host
        var checksList = h.healthChecks.length === 0
            ? '<div style="font-size:0.78rem;color:#71717a;">Sin chequeos activos reportados por el agente.</div>'
            : h.healthChecks.map(function(c) {
                var cls = c.summary === "GOOD" ? "txt-green" : (c.summary === "DISABLED" ? "txt-neutral" : "txt-amber");
                return '<div class="chk-row"><span style="color:#d4d4d8;">' + c.name + '</span><span class="' + cls + '">' + c.summary + '</span></div>';
            }).join("");

        var healthHtml = '<div class="host-box" style="margin-bottom:0;"><div class="host-box-title">4. Chequeos de Salud del Host (' + h.healthChecks.length + ')</div>' + checksList + '</div>';

        detailPanel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;">' +
            '<h2 class="section-title" style="margin-bottom:0;">Nodo • <span>' + h.short_host + '</span></h2>' +
            '<span class="badge-ver">' + h.ipAddress + '</span></div>' +
            '<div style="max-height:calc(100vh - 340px);overflow-y:auto;padding-right:4px;">' +
            hwHtml + netHtml + rolesHtml + healthHtml + '</div>';
    } catch (err) {
        detailPanel.innerHTML = '<div class="error-box">Error de red al consultar detalle del nodo</div>';
    }
}

async function inspectService(card) {
    document.querySelectorAll(".card-clickable").forEach(function(c) {
        c.classList.remove("card-selected");
    });
    card.classList.add("card-selected");

    stopRoleMonitor();
    currentHostId = null;
    currentService = card.getAttribute("data-service");
    currentCluster = card.getAttribute("data-cluster");
    var nameEl = card.querySelector(".srv-name");
    currentDisplayName = nameEl ? nameEl.textContent.trim() : currentService;

    await loadServiceRoles(false);
}

async function loadServiceRoles(isSilent) {
    var detailPanel = document.getElementById("detail-panel");
    var isThisServiceOn = !!monitoredServices[currentService];

    if (!isSilent) {
        detailPanel.innerHTML = '<div style="padding:2rem;text-align:center;color:#22d3ee;font-size:0.85rem;">Consultando nodos de <strong>' + currentDisplayName + '</strong>...</div>';
    } else {
        var st = document.getElementById("role-sync-status");
        if (st) st.innerHTML = '<span style="color:#fbbf24;">Sync...</span>';
    }

    try {
        var url = "/api/service-roles?cluster=" + encodeURIComponent(currentCluster) + "&service=" + encodeURIComponent(currentService);
        var res = await fetch(url);
        var data = await res.json();

        if (!data.ok) {
            detailPanel.innerHTML = '<div class="error-box"><strong>Error:</strong> ' + data.error + '</div>';
            stopRoleMonitor();
            return;
        }

        var checkedAttr = isThisServiceOn ? "checked" : "";
        var initialStatus = isThisServiceOn ? '<span style="color:#22d3ee;">● 30s</span>' : "Pausado";

        var headerHtml = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;flex-wrap:wrap;gap:8px;">' +
            '<div><h2 class="section-title" style="margin-bottom:2px;">Nodos • <span>' + currentDisplayName + '</span></h2>' +
            '<span style="font-size:0.72rem;color:#71717a;">' + data.roles.length + ' instancia(s) detectadas</span></div>' +
            '<div class="live-controls">' +
                '<span id="role-sync-status">' + initialStatus + '</span>' +
                '<label class="switch" style="margin-bottom:0;" title="Monitorear solo ' + currentDisplayName + ' cada 30s">' +
                    '<input type="checkbox" id="role-refresh-toggle" ' + checkedAttr + ' onchange="toggleRoleMonitor(this)">' +
                    '<span class="slider"></span>' +
                '</label>' +
                '<span>30s</span>' +
            '</div></div>';

        if (data.roles.length === 0) {
            detailPanel.innerHTML = headerHtml + '<div class="detail-placeholder" style="min-height:220px;"><div style="color:#a1a1aa;font-size:0.85rem;">Este servicio no tiene demonios fijos asignados a un nodo.</div></div>';
        } else {
            var rolesHtml = data.roles.map(function(r) {
                var badge = "";
                if (r.roleState === "STARTED") {
                    badge = '<span class="pill-on"><span class="dot-alive"></span> ' + r.roleState + '</span>';
                } else if (r.roleState === "NA") {
                    badge = '<span class="badge-ver">' + r.roleState + '</span>';
                } else {
                    badge = '<span class="pill-off"><span class="dot-dead"></span> ' + r.roleState + '</span>';
                }

return '' + r.hostname + '' + r.type + '' + badge + 'Salud: ' + r.healthSummary + '';
}).join("");
detailPanel.innerHTML = headerHtml + '' + rolesHtml + '';
}
roleSecondsLeft = 30;
if (isThisServiceOn && !roleIntervalId) {
startRoleMonitor();
}
} catch (err) {
if (!isSilent) {
detailPanel.innerHTML = 'Error de red al consultar roles';
}
}
}
var toggle = document.getElementById("auto-refresh-toggle");
var syncStatus = document.getElementById("sync-status");
var intervalId = null;
var countdownId = null;
var secondsLeft = 60;
if (toggle) {
if (localStorage.getItem("cm_auto_refresh") === "true") {
toggle.checked = true;
startAutoRefresh();
}
toggle.addEventListener("change", function() {
localStorage.setItem("cm_auto_refresh", toggle.checked);
if (toggle.checked) { startAutoRefresh(); } else { stopAutoRefresh(); }
});
}
function startAutoRefresh() {
stopAutoRefresh();
secondsLeft = 60;
syncStatus.innerHTML = '● ' + secondsLeft + 's';
countdownId = setInterval(function() {
secondsLeft--;
if (secondsLeft <= 0) secondsLeft = 60;
syncStatus.innerHTML = '● ' + secondsLeft + 's';
}, 1000);
intervalId = setInterval(fetchLiveStatus, 60000);
}
function stopAutoRefresh() {
clearInterval(intervalId);
clearInterval(countdownId);
if (syncStatus) syncStatus.textContent = "Pausado";
}
async function fetchLiveStatus() {
syncStatus.innerHTML = 'Sync...';
try {
var res = await fetch("/api/live-status");
var payload = await res.json();
if (!payload.ok) { syncStatus.innerHTML = 'Err'; return; }
renderNodes(payload.hosts);
renderClusters(payload.clusters);
secondsLeft = 60;
} catch (err) {
syncStatus.innerHTML = 'Red';
}
}
function renderNodes(hosts) {
document.getElementById("nodes-count").textContent = hosts.length;
document.getElementById("nodes-container").innerHTML = hosts.map(function(h) {
var cardClass = h.is_alive ? "card-alive" : "card-dead";
var selectedClass = (h.hostId === currentHostId) ? " card-selected" : "";
var pillHtml = h.is_alive
? ' ON'
: ' DEAD';
var ram = (h.totalPhysMemBytes / (1024 * 1024 * 1024)).toFixed(1);
var hb = h.hb_seconds !== null ? h.hb_seconds + "s" : "?";
return '' + h.ipAddress + '' + pillHtml + '' + h.hostname + 'CPU: ' + h.numCores + 'cRAM: ' + ram + 'GHB: ' + hb + '';
}).join("");
}
function renderClusters(clusters) {
document.getElementById("clusters-container").innerHTML = clusters.map(function(c) {
var servicesHtml = c.services.map(function(s) {
var name = s.displayName || s.name;
var selectedClass = (s.name === currentService) ? " card-selected" : "";
var stateClass = s.serviceState === "STARTED" ? "txt-green" : (s.serviceState === "NA" ? "txt-neutral" : "txt-red");
var healthClass = s.healthSummary === "GOOD" ? "txt-green" : "txt-amber";
return '' + (s.icon_svg || "") + '' + name + 'Estado' + s.serviceState + 'Salud' + s.healthSummary + '';
}).join("");
return 'Servicios • ' + c.name + '' + servicesHtml + '';
}).join("");
}
