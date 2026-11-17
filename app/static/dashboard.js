var certIntervalId = null;
var certCountdownId = null;
var certSecondsLeft = 60;
var certMonitorActive = false;

function stopCertMonitor() {
    clearInterval(certIntervalId);
    clearInterval(certCountdownId);
    certIntervalId = null;
    certCountdownId = null;
}

function startCertMonitor() {
    stopCertMonitor();
    certSecondsLeft = 60;
    var st = document.getElementById("cert-sync-status");
    if (st) st.innerHTML = '<span style="color:#22d3ee;">● ' + certSecondsLeft + 's</span>';

    certCountdownId = setInterval(function() {
        certSecondsLeft--;
        if (certSecondsLeft <= 0) certSecondsLeft = 60;
        var el = document.getElementById("cert-sync-status");
        if (el) el.innerHTML = '<span style="color:#22d3ee;">● ' + certSecondsLeft + 's</span>';
    }, 1000);

    certIntervalId = setInterval(function() {
        if (certMonitorActive && document.getElementById("cert-sync-status")) {
            loadCertificates(true);
        } else {
            stopCertMonitor();
        }
    }, 60000);
}

function toggleCertMonitor(checkbox) {
    certMonitorActive = checkbox.checked;
    if (certMonitorActive) {
        startCertMonitor();
    } else {
        stopCertMonitor();
        var el = document.getElementById("cert-sync-status");
        if (el) el.textContent = "Pausado";
    }
}

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
    stopCertMonitor();
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
    stopCertMonitor();
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
    stopCertMonitor();
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
    stopCertMonitor();
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
    stopCertMonitor();
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

var hClass = r.healthSummary === "GOOD" ? "txt-green" : "txt-amber";
                return '<div class="role-item">' +
                    '<div><span class="role-host">' + r.hostname + '</span><span class="role-type">' + r.type + '</span></div>' +
                    '<div style="text-align:right;">' + badge + '<div style="font-size:0.7rem;color:#a1a1aa;margin-top:4px;">Salud: <span class="' + hClass + '">' + r.healthSummary + '</span></div></div>' +
                '</div>';
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
    await fetchLiveAgent("nodes");
}

// Agente aislado: recibe 'nodes' o 'services' para actualizar solo esa seccion
async function fetchLiveAgent(target) {
    if (target === "nodes" && syncStatus) {
        syncStatus.innerHTML = '<span style="color:#fbbf24;">Sync...</span>';
    }
    try {
        var res = await fetch("/api/live-status");
        var payload = await res.json();
        if (!payload.ok) {
            if (target === "nodes" && syncStatus) syncStatus.innerHTML = '<span style="color:#fb7185;">Err</span>';
            return;
        }
        if (target === "nodes") {
            renderNodes(payload.hosts);
            secondsLeft = 60;
        } else if (target === "services") {
            renderClusters(payload.clusters);
        }
    } catch (err) {
        if (target === "nodes" && syncStatus) syncStatus.innerHTML = '<span style="color:#fb7185;">Red</span>';
    }
}

function renderNodes(hosts) {
    var countEl = document.getElementById("nodes-count");
    if (countEl) countEl.textContent = hosts.length;
    var container = document.getElementById("nodes-container");
    if (!container) return;

    container.innerHTML = hosts.map(function(h) {
        var cardClass = h.is_alive ? "card-alive" : "card-dead";
        var selectedClass = (h.hostId === currentHostId) ? " card-selected" : "";
        var pillHtml = h.is_alive
            ? '<span class="pill-on"><span class="dot-alive"></span> ON</span>'
            : '<span class="pill-off"><span class="dot-dead"></span> DEAD</span>';
        var ram = (h.totalPhysMemBytes / (1024 * 1024 * 1024)).toFixed(1);
        var hb = (h.hb_seconds !== null && h.hb_seconds !== undefined) ? h.hb_seconds + "s" : "?";

        return '<div class="card card-clickable ' + cardClass + selectedClass + '" data-host-id="' + h.hostId + '" onclick="inspectHost(this)">' +
            '<div class="card-top">' +
                '<span class="ip">' + h.ipAddress + '</span>' +
                pillHtml +
            '</div>' +
            '<div class="hostname" title="' + h.hostname + '">' + h.hostname + '</div>' +
            '<div class="specs">' +
                '<span>CPU: <strong>' + h.numCores + 'c</strong></span>' +
                '<span>RAM: <strong>' + ram + 'G</strong></span>' +
                '<span>HB: <strong>' + hb + '</strong></span>' +
            '</div>' +
        '</div>';
    }).join("");
}

function renderClusters(clusters) {
    var container = document.getElementById("clusters-container");
    if (!container) return;

    container.innerHTML = clusters.map(function(c) {
        var servicesHtml = c.services.map(function(s) {
            var name = s.displayName || s.name;
            var selectedClass = (s.name === currentService) ? " card-selected" : "";
            var stateClass = s.serviceState === "STARTED" ? "txt-green" : (s.serviceState === "NA" ? "txt-neutral" : "txt-red");
            var healthClass = s.healthSummary === "GOOD" ? "txt-green" : "txt-amber";

            return '<div class="card card-clickable' + selectedClass + '" data-cluster="' + c.name + '" data-service="' + s.name + '" onclick="inspectService(this)">' +
                '<div class="srv-header">' +
                    '<div class="srv-icon">' + (s.icon_svg || "") + '</div>' +
                    '<div class="srv-name" title="' + name + '">' + name + '</div>' +
                '</div>' +
                '<div class="srv-row"><span>Estado</span><span class="' + stateClass + '">' + s.serviceState + '</span></div>' +
                '<div class="srv-row"><span>Salud</span><span class="' + healthClass + '">' + s.healthSummary + '</span></div>' +
            '</div>';
        }).join("");

        return '<h2 class="section-title">Servicios • <span>' + c.name + '</span></h2>' +
               '<div class="grid-services">' + servicesHtml + '</div>';
    }).join("");
}


async function inspectCertificates() {
    document.querySelectorAll(".card-clickable").forEach(function(c) {
        c.classList.remove("card-selected");
    });
    stopRoleMonitor();
    stopCertMonitor();
    currentService = null;
    currentHostId = null;

    await loadCertificates(false);
}

async function loadCertificates(isSilent) {
    var detailPanel = document.getElementById("detail-panel");
    if (!isSilent) {
        detailPanel.innerHTML = '<div style="padding:2rem;text-align:center;color:#22d3ee;font-size:0.85rem;">Escaneando certificados TLS del clúster...</div>';
    } else {
        var st = document.getElementById("cert-sync-status");
        if (st) st.innerHTML = '<span style="color:#fbbf24;">Sync...</span>';
    }

    try {
        var res = await fetch("/api/tls-check");
        if (res.status === 401) {
            stopAutoRefresh();
            stopRoleMonitor();
            stopCertMonitor();
            window.location.href = "/login";
            return;
        }
        var data = await res.json();
        if (!data.ok) {
            detailPanel.innerHTML = '<div class="error-box"><strong>Error:</strong> ' + data.error + '</div>';
            stopCertMonitor();
            return;
        }

        var checkedAttr = certMonitorActive ? "checked" : "";
        var initialStatus = certMonitorActive ? '<span style="color:#22d3ee;">● 60s</span>' : "Pausado";

        var cardsHtml = data.certs.map(function(c) {
            var badge = "";
            if (c.status === "VALID") {
                badge = '<span class="pill-on"><span class="dot-alive"></span> ' + c.daysLeft + ' días</span>';
            } else if (c.status === "WARNING") {
                badge = '<span class="pill-off" style="border-color:#fbbf24;color:#fbbf24;background:rgba(251,191,36,0.12);">' + c.daysLeft + ' días</span>';
            } else if (c.status === "EXPIRED") {
                badge = '<span class="pill-off"><span class="dot-dead"></span> VENCIDO</span>';
            } else {
                badge = '<span class="badge-ver">SIN TLS</span>';
            }

            return '<div class="host-box" style="margin-bottom:0.75rem;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem;">' +
                    '<strong style="color:#f4f4f5;font-size:0.85rem;">' + c.label + '</strong>' +
                    badge +
                '</div>' +
                '<div style="font-size:0.74rem;color:#a1a1aa;font-family:monospace;">Expira: <strong style="color:#e4e4e7;">' + c.expiresAt + '</strong></div>' +
                '<div style="font-size:0.7rem;color:#71717a;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + c.subject + '">CN: ' + c.subject + '</div>' +
            '</div>';
        }).join("");

        detailPanel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;flex-wrap:wrap;gap:8px;">' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
                '<h2 class="section-title" style="margin-bottom:0;">Auditoría • <span>Certificados TLS</span></h2>' +
                '<span class="badge-ver">' + data.certs.length + ' endpoints</span>' +
            '</div>' +
            '<div class="live-controls" title="Actualizar certificados automáticamente cada 60s">' +
                '<span id="cert-sync-status">' + initialStatus + '</span>' +
                '<label class="switch" style="margin-bottom:0;">' +
                    '<input type="checkbox" id="cert-refresh-toggle" ' + checkedAttr + ' onchange="toggleCertMonitor(this)">' +
                    '<span class="slider"></span>' +
                '</label>' +
                '<span>60s</span>' +
            '</div>' +
        '</div>' +
        '<div style="max-height:calc(100vh - 340px);overflow-y:auto;padding-right:4px;">' + cardsHtml + '</div>';

        certSecondsLeft = 60;
        if (certMonitorActive && !certIntervalId) {
            startCertMonitor();
        }
    } catch (err) {
        if (!isSilent) {
            detailPanel.innerHTML = '<div class="error-box">Error de red al auditar certificados TLS</div>';
        }
    }
}

function inspectAbout() {
    document.querySelectorAll(".card-clickable").forEach(function(c) {
        c.classList.remove("card-selected");
    });
    stopRoleMonitor();
    stopCertMonitor();
    currentService = null;
    currentHostId = null;

    var detailPanel = document.getElementById("detail-panel");
    detailPanel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.8rem;border-bottom:1px solid #27272a;">' +
        '<h2 class="section-title" style="margin-bottom:0;">Acerca de • <span>Sistema</span></h2>' +
        '<span class="pill-on">v1.0</span></div>' +
        '<div class="host-box">' +
            '<div class="host-box-title">Tablero Cloudera API Monitor</div>' +
            '<p style="font-size:0.82rem;color:#d4d4d8;line-height:1.6;margin-bottom:0.8rem;">' +
                'Plataforma interna de observabilidad, diagnóstico en tiempo real y auditoría operativa para clústeres Cloudera sin licencia comercial.' +
            '</p>' +
            '<div class="kv-grid">' +
                '<div class="kv-item"><span>Versión</span><strong>v1.0.0 (Split Workspace)</strong></div>' +
                '<div class="kv-item"><span>Seguridad</span><strong>AES Fernet + Cloudera Auth</strong></div>' +
                '<div class="kv-item"><span>Equipo</span><strong>Big Data • Seguritech</strong></div>' +
                '<div class="kv-item"><span>Motor</span><strong>Python / Flask REST</strong></div>' +
            '</div>' +
        '</div>' +
        '<div class="host-box" style="margin-bottom:0;">' +
            '<div class="host-box-title">Módulos Activos v1</div>' +
            '<div class="chk-row"><span style="color:#d4d4d8;">Telemetría de Nodos y Heartbeats</span><span class="txt-green">ACTIVO</span></div>' +
            '<div class="chk-row"><span style="color:#d4d4d8;">Inspección de Servicios y Demonios</span><span class="txt-green">ACTIVO</span></div>' +
            '<div class="chk-row"><span style="color:#d4d4d8;">Auditoría de Certificados TLS</span><span class="txt-green">ACTIVO</span></div>' +
            '<div class="chk-row"><span style="color:#d4d4d8;">Consola REST API Personalizada</span><span class="txt-green">ACTIVO</span></div>' +
        '</div>';
}
