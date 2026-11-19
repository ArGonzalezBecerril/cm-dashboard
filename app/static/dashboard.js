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
            var slotId = "role-ctrl-" + r.name.replace(/[^a-zA-Z0-9_-]/g, "_");
            var ctrlHtml = "";
            if (r.activeCommand && r.activeCommand.status === "RUNNING") {
                var actLabels = { start: "INICIANDO...", stop: "DETENIENDO...", restart: "REINICIANDO..." };
                var aTxt = actLabels[r.activeCommand.action] || "EJECUTANDO...";
                ctrlHtml = '<div style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.35);padding:3px 9px;border-radius:7px;">' +
                    '<span class="worm-loader"><span class="worm-dot"></span><span class="worm-dot"></span><span class="worm-dot"></span></span>' +
                    '<span style="font-size:0.68rem;font-weight:800;color:#22d3ee;">' + aTxt + '</span></div>';
            } else if (r.controllable !== false) {
                ctrlHtml = '<div style="display:inline-flex;gap:4px;margin-top:6px;">' +
                    '<button type="button" title="Iniciar instancia" data-rname="' + r.name + '" data-rtype="' + r.type + '" data-rhost="' + r.hostname + '" data-ract="start" onclick="triggerSingleRoleBtn(this)" style="width:24px!important;height:22px!important;padding:0!important;background:#18181b!important;color:#34d399!important;border:1px solid #27272a!important;border-radius:6px!important;font-size:0.65rem!important;cursor:pointer;">▶</button>' +
                    '<button type="button" title="Detener instancia" data-rname="' + r.name + '" data-rtype="' + r.type + '" data-rhost="' + r.hostname + '" data-ract="stop" onclick="triggerSingleRoleBtn(this)" style="width:24px!important;height:22px!important;padding:0!important;background:#18181b!important;color:#fb7185!important;border:1px solid #27272a!important;border-radius:6px!important;font-size:0.65rem!important;cursor:pointer;">■</button>' +
                    '<button type="button" title="Reiniciar instancia" data-rname="' + r.name + '" data-rtype="' + r.type + '" data-rhost="' + r.hostname + '" data-ract="restart" onclick="triggerSingleRoleBtn(this)" style="width:24px!important;height:22px!important;padding:0!important;background:#18181b!important;color:#22d3ee!important;border:1px solid #27272a!important;border-radius:6px!important;font-size:0.72rem!important;cursor:pointer;">↻</button></div>';
            }
            return '<div class="role-item"><div><span class="role-host">' + r.hostname + '</span><span class="role-type">' + r.type + '</span></div>' +
                '<div style="text-align:right;">' + b +
                '<div style="font-size:0.7rem;color:#a1a1aa;margin-top:4px;">Salud: <span class="' + hc + '">' + r.healthSummary + '</span></div>' +
                '<div id="' + slotId + '">' + ctrlHtml + '</div></div></div>';
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
        (data.roles || []).forEach(function(r) { if (r.activeCommand && r.activeCommand.status === "RUNNING") watchSingleRoleCommand(r.name, r.activeCommand.commandId, r.activeCommand.action); });
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

async function inspectCertificates() {
    if (typeof window.openWorkspaceCurtain === "function") window.openWorkspaceCurtain(); document.querySelectorAll(".card-clickable").forEach(function(c) { c.classList.remove("card-selected"); }); stopRoleMonitor(); stopCertMonitor(); currentService = null; currentHostId = null; await loadCertificates(false); }

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
    if (typeof window.openWorkspaceCurtain === "function") window.openWorkspaceCurtain();
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




/* === MÓDULO MÉTRICAS REAL-TIME (MULTI-NODO DINÁMICO 1/3) === */
var srvMetricsTimer = null, srvAbortCtrl = null, isSrvMetricsActive = false;
var srvCharts = {}, srvCinemaChart = null, activeCinemaKey = null, lastSrvData = null;

var NODE_PALETTE = new Array("#22d3ee", "#a855f7", "#34d399", "#fbbf24", "#fb7185", "#38bdf8", "#f97316", "#e879f9", "#4ade80", "#facc15", "#60a5fa");

var HDFS_CHART_META = {
    cpu_user: { title: "HDFS • CPU Usuario por Nodo", unit: "s/s", desc: "Segundos de CPU consumidos por segundo (1.0 = 1 núcleo al 100%)" },
    heap:     { title: "HDFS • Memoria Heap JVM",     unit: "MB",  desc: "Megabytes (MB) de memoria RAM Java en uso por el demonio" },
    gc_time:  { title: "HDFS • Tiempo GC JVM",        unit: "ms",  desc: "Milisegundos (ms) acumulados en pausas de Garbage Collector" },
    fd_open:  { title: "HDFS • Archivos/Sockets",     unit: "fds", desc: "Cantidad de archivos y sockets TCP abiertos por el proceso" }
};

var GEN_CHART_META = {
    cpu_user: { title: "CPU Usuario",      unit: "s/s", desc: "Segundos de CPU usuario consumidos por segundo" },
    cpu_sys:  { title: "CPU Sistema",      unit: "s/s", desc: "Segundos de CPU kernel/sistema consumidos por segundo" },
    heap:     { title: "Memoria Heap JVM", unit: "MB",  desc: "Megabytes (MB) de memoria RAM Java en uso" },
    gc_time:  { title: "Tiempo GC JVM",    unit: "ms",  desc: "Milisegundos (ms) de pausa del Garbage Collector" }
};

function getActiveMeta() {
    var s = (currentService || "").toLowerCase();
    return s.indexOf("hdfs") !== -1 ? HDFS_CHART_META : GEN_CHART_META;
}

function stopServiceMetrics() {
    isSrvMetricsActive = false;
    if (srvMetricsTimer) { clearInterval(srvMetricsTimer); srvMetricsTimer = null; }
    if (srvAbortCtrl) { try { srvAbortCtrl.abort(); } catch (e) {} srvAbortCtrl = null; }
    Object.keys(srvCharts).forEach(function(k) {
        if (srvCharts[k]) { srvCharts[k].destroy(); delete srvCharts[k]; }
    });
}

/* === MÓDULO MÉTRICAS REAL-TIME (MULTI-NODO DINÁMICO 2/3) === */
(function initMetricsTabObserver() {
    var dp = document.getElementById("detail-panel");
    if (!dp) return;
    var obs = new MutationObserver(function() {
        if (document.getElementById("srv-metrics-tab-btn")) return;
        var btns = Array.from(dp.querySelectorAll("button"));
        var histBtn = btns.find(function(b) { return b.textContent.indexOf("Historial de Acciones") !== -1; });
        if (!histBtn || !histBtn.parentElement) return;

        var mBtn = document.createElement("button");
        mBtn.type = "button";
        mBtn.id = "srv-metrics-tab-btn";
        mBtn.className = histBtn.className;
        mBtn.textContent = "Métricas Real-Time";
        mBtn.onclick = function() { openServiceMetricsTab(mBtn, histBtn.parentElement); };
        histBtn.parentElement.appendChild(mBtn);

        btns.forEach(function(otherBtn) {
            if (otherBtn.id !== "srv-metrics-tab-btn") {
                otherBtn.addEventListener("click", function() {
                    stopServiceMetrics();
                    mBtn.classList.remove("active");
                    mBtn.style.borderColor = "";
                    mBtn.style.color = "";
                    var mBox = document.getElementById("srv-tab-metrics");
                    if (mBox) mBox.style.display = "none";
                    var sib = histBtn.parentElement.nextElementSibling;
                    while (sib) {
                        if (sib.id !== "srv-tab-metrics") sib.style.display = "";
                        sib = sib.nextElementSibling;
                    }
                });
            }
        });
    });
    obs.observe(dp, { childList: true, subtree: true });
})();

function openServiceMetricsTab(mBtn, tabBar) {
    var dp = document.getElementById("detail-panel");
    if (!dp) return;
    stopRoleMonitor();

    Array.from(tabBar.querySelectorAll("button")).forEach(function(b) {
        b.classList.remove("active");
        b.style.borderColor = "";
        b.style.color = "";
    });
    mBtn.classList.add("active");
    mBtn.style.borderColor = "#06b6d4";
    mBtn.style.color = "#22d3ee";

    var sib = tabBar.nextElementSibling;
    while (sib) {
        if (sib.id !== "srv-tab-metrics") sib.style.display = "none";
        sib = sib.nextElementSibling;
    }

    var mBox = document.getElementById("srv-tab-metrics");
    if (!mBox) {
        mBox = document.createElement("div");
        mBox.id = "srv-tab-metrics";
        mBox.style.marginTop = "1rem";
        tabBar.insertAdjacentElement("afterend", mBox);
    }
    mBox.style.display = "block";
    startServiceMetricsLoop();
}

function startServiceMetricsLoop() {
    stopServiceMetrics(); isSrvMetricsActive = true;
    var metaMap = getActiveMeta();
    var box = document.getElementById("srv-tab-metrics");
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">' +
        '<span id="srv-alive-info" style="font-size:0.75rem;color:#a1a1aa;">Consultando nodos vivos (' + (currentService || "") + ')...</span>' +
        '<span id="srv-live-badge" class="pill-on"><span class="dot-alive"></span> LIVE</span></div><div class="knox-metrics-grid">';
    Object.keys(metaMap).forEach(function(k) {
        h += '<div class="metric-mini-card"><div class="metric-card-header"><span class="metric-card-title">' +
            metaMap[k].title + '</span><button type="button" class="metric-expand-btn" onclick="openGlassCinema(\'' + k + '\')">⛶</button>' +
            '</div><div class="metric-canvas-wrap"><canvas id="srv-canvas-' + k + '"></canvas></div></div>';
    });
    box.innerHTML = h + '</div>';
    fetchServiceMetricsNow();
    srvMetricsTimer = setInterval(function() { isSrvMetricsActive ? fetchServiceMetricsNow() : stopServiceMetrics(); }, 5000);
}



/* === MÓDULO MÉTRICAS REAL-TIME (MULTI-NODO DINÁMICO 3/3 - SQLITE STREAM) === */
function stopServiceMetrics() {
    isSrvMetricsActive = false;
    if (srvMetricsTimer) { clearInterval(srvMetricsTimer); srvMetricsTimer = null; }
    if (srvAbortCtrl) { try { srvAbortCtrl.abort(); } catch (e) {} srvAbortCtrl = null; }
    Object.keys(srvCharts).forEach(function(k) {
        if (srvCharts[k]) { srvCharts[k].destroy(); delete srvCharts[k]; }
    });
    fetch("/api/metrics-stop", { method: "POST" }).catch(function() {});
}

function startServiceMetricsLoop() {
    stopServiceMetrics(); isSrvMetricsActive = true;
    var metaMap = getActiveMeta();
    var box = document.getElementById("srv-tab-metrics");
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">' +
        '<span id="srv-alive-info" style="font-size:0.75rem;color:#a1a1aa;">Iniciando hilo SQLite (' + (currentService || "") + ')...</span>' +
        '<span id="srv-live-badge" class="pill-on"><span class="dot-alive"></span> LIVE SQLITE</span></div><div class="knox-metrics-grid">';
    Object.keys(metaMap).forEach(function(k) {
        h += '<div class="metric-mini-card"><div class="metric-card-header"><span class="metric-card-title">' +
            metaMap[k].title + '</span><button type="button" class="metric-expand-btn" onclick="openGlassCinema(\'' + k + '\')">⛶</button>' +
            '</div><div class="metric-canvas-wrap"><canvas id="srv-canvas-' + k + '"></canvas></div></div>';
    });
    box.innerHTML = h + '</div>';
    fetchServiceMetricsNow();
    srvMetricsTimer = setInterval(function() { isSrvMetricsActive ? fetchServiceMetricsNow() : stopServiceMetrics(); }, 3000);
}

function formatLegendWithValue(serie, lg) {
    if (!lg) return serie.label;
    var lastPt = serie.points.at(-1);
    var vStr = lastPt ? (" [" + lastPt.v + "]") : "";
    return serie.label.replace(/\.seguritech\.com/gi, "") + vStr;
}

function syncChartInPlace(chart, seriesList, lg) {
    var firstEl = seriesList.find(function() { return true; });
    if (!firstEl || !firstEl.points) return;

    chart.data.labels = firstEl.points.map(function(p) { return p.t; });
    seriesList.forEach(function(serie, idx) {
        var color = NODE_PALETTE.at(idx % NODE_PALETTE.length);
        var ds = chart.data.datasets.at(idx);
        var lblText = formatLegendWithValue(serie, lg);
        if (ds) {
            ds.label = lblText;
            ds.data = serie.points.map(function(p) { return p.v; });
        } else {
            chart.data.datasets.push({
                label: lblText,
                data: serie.points.map(function(p) { return p.v; }),
                borderColor: color,
                backgroundColor: color + "18",
                borderWidth: lg ? 2.2 : 1.6,
                pointRadius: lg ? 3 : 1.5,
                tension: 0.3,
                fill: false
            });
        }
    });
    chart.update("active");
}

async function fetchServiceMetricsNow() {
    if (!isSrvMetricsActive || !currentService) return;
    if (srvAbortCtrl) { try { srvAbortCtrl.abort(); } catch (e) {} }
    srvAbortCtrl = new AbortController();
    var bg = document.getElementById("srv-live-badge");

    try {
        var r = await fetch("/api/metrics-stream?service=" + encodeURIComponent(currentService), { signal: srvAbortCtrl.signal });
        var d = await r.json();
        if (!isSrvMetricsActive) return;
        if (d.ok && d.metrics) {
            lastSrvData = d.metrics;
            var infoEl = document.getElementById("srv-alive-info");
            if (infoEl) {
                infoEl.textContent = "Roles vivos: " + (d.alive_count || 0) + " • Buffer SQLite en vivo (5s)";
            }
            var metaMap = getActiveMeta();
            Object.keys(metaMap).forEach(function(k) {
                var cv = document.getElementById("srv-canvas-" + k);
                if (!cv) return;
                var listSeries = d.metrics[k] || new Array();
                if (listSeries.length === 0) return;

                if (srvCharts[k]) {
                    syncChartInPlace(srvCharts[k], listSeries, false);
                } else {
                    srvCharts[k] = new Chart(cv.getContext("2d"), buildMultiChartCfg(k, listSeries, false));
                }
            });

            if (activeCinemaKey && srvCinemaChart && lastSrvData[activeCinemaKey]) {
                syncChartInPlace(srvCinemaChart, lastSrvData[activeCinemaKey], true);
            }
            if (bg) bg.innerHTML = '<span class="dot-alive"></span> LIVE';
        }
    } catch (e) { if (e.name !== "AbortError" && bg) bg.innerHTML = '<span class="dot-dead"></span> ERR'; }
}

function buildMultiChartCfg(key, rawMetric, lg) {
    var datasets = new Array();
    var labels = new Array("0");

    var firstEl = rawMetric.find(function() { return true; });
    if (firstEl && firstEl.points) {
        labels = firstEl.points.map(function(p) { return p.t; });
        rawMetric.forEach(function(serie, idx) {
            var color = NODE_PALETTE.at(idx % NODE_PALETTE.length);
            datasets.push({
                label: formatLegendWithValue(serie, lg),
                data: serie.points.map(function(p) { return p.v; }),
                borderColor: color,
                backgroundColor: color + "18",
                borderWidth: lg ? 2.2 : 1.6,
                pointRadius: lg ? 3 : 1.5,
                tension: 0.3,
                fill: false
            });
        });
    }

    return {
        type: "line",
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 350 },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    display: lg,
                    position: "bottom",
                    labels: {
                        color: "#e4e4e7",
                        boxWidth: 10,
                        boxHeight: 10,
                        padding: 10,
                        font: { size: 11, family: "monospace" }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            var meta = (getActiveMeta()[key] || {});
                            var u = meta.unit || "";
                            return " " + ctx.dataset.label + ": " + ctx.parsed.y + " " + u;
                        },
                        afterBody: function() {
                            var meta = (getActiveMeta()[key] || {});
                            return meta.desc ? ["", "ℹ " + meta.desc] : [];
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { color: "#71717a", maxTicksLimit: lg ? 10 : 4, font: { size: lg ? 11 : 9 } }, grid: { color: "#18181b" } },
                y: { beginAtZero: true, ticks: { color: "#a1a1aa", font: { size: lg ? 11 : 9 } }, grid: { color: "#27272a" } }
            }
        }
    };
}

function openGlassCinema(key) {
    closeGlassCinema(true); activeCinemaKey = key;
    var metaMap = getActiveMeta();
    var ov = document.createElement("div"); ov.id = "knox-cinema-overlay"; ov.className = "glass-cinema-overlay";
    ov.onclick = function(e) { if (e.target === ov) closeGlassCinema(false); };
    ov.innerHTML = '<div id="knox-cinema-modal" class="glass-cinema-modal"><div class="glass-cinema-header"><span class="glass-cinema-title">' + metaMap[key].title + '</span><button type="button" class="glass-close-btn" onclick="closeGlassCinema(false)">✕</button></div><div class="glass-cinema-canvas-wrap"><canvas id="knox-cinema-canvas"></canvas></div></div>';
    document.body.appendChild(ov);
    var md = document.getElementById("knox-cinema-modal");
    gsap.fromTo(ov, { opacity: 0 }, { opacity: 1, duration: 0.22 });
    gsap.fromTo(md, { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.34, ease: "power3.out" });
    var rawMetric = (lastSrvData && lastSrvData[key]) ? lastSrvData[key] : new Array();
    srvCinemaChart = new Chart(document.getElementById("knox-cinema-canvas").getContext("2d"), buildMultiChartCfg(key, rawMetric, true));
}

function closeGlassCinema(imm) {
    var ov = document.getElementById("knox-cinema-overlay"), md = document.getElementById("knox-cinema-modal");
    if (!ov) return;
    function del() { if (srvCinemaChart) { srvCinemaChart.destroy(); srvCinemaChart = null; } activeCinemaKey = null; if (ov.parentNode) ov.parentNode.removeChild(ov); }
    if (imm || !md) { del(); }
    else {
        gsap.to(md, { scale: 0.08, opacity: 0, duration: 0.26, ease: "power3.in" });
        gsap.to(ov, { opacity: 0, duration: 0.26, onComplete: del });
    }
}

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && document.getElementById("knox-cinema-overlay")) closeGlassCinema(false);
});


/* === TELÓN COLAPSABLE ESTILO MACOS (GSAP) === */
(function initWorkspaceCurtain() {
    var dp = document.getElementById("detail-panel");
    if (!dp) return;

    var rightPane = dp;
    while (rightPane.parentElement && rightPane.parentElement.children.length < 2) {
        rightPane = rightPane.parentElement;
    }
    var workspace = rightPane.parentElement;
    var leftPane = rightPane.previousElementSibling;
    if (!workspace || !leftPane) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "workspace-curtain-btn";
    btn.className = "curtain-toggle-btn";
    btn.title = "Cerrar / Abrir panel";
    btn.innerHTML = "❯";
    document.body.appendChild(btn);

    var isClosed = false;
    var isAnimating = false;

    function syncBtnPosition() {
        if (isClosed) {
            gsap.to(btn, { left: window.innerWidth - 34, duration: 0.45, ease: "power3.inOut" });
            btn.innerHTML = "❮";
        } else {
            var lRect = leftPane.getBoundingClientRect();
            var rRect = rightPane.getBoundingClientRect();
            var midGap = (lRect.right + rRect.left) / 2;
            var targetX = Math.max(12, midGap - 11);
            gsap.to(btn, { left: targetX, duration: 0.45, ease: "power3.inOut" });
            btn.innerHTML = "❯";
        }
    }

    function toggleMacCurtain(closeIt) {
        if (isAnimating || isClosed === closeIt) return;
        isAnimating = true;
        isClosed = closeIt;

        if (closeIt) {
            if (typeof stopServiceMetrics === "function") stopServiceMetrics();
            if (typeof stopRoleMonitor === "function") stopRoleMonitor();
            if (typeof stopAppStorageMonitor === "function") stopAppStorageMonitor();
            var tb = document.getElementById("rep-scroll-top-btn"); if (tb) tb.style.display = "none";

            gsap.to(rightPane, {
                x: 80, opacity: 0, scale: 0.96, duration: 0.38, ease: "power3.in",
                onComplete: function() {
                    rightPane.style.display = "none";
                    workspace.style.gridTemplateColumns = "1fr";
                    leftPane.style.width = "100%";
                    var grids = leftPane.querySelectorAll(".cards-grid, .nodes-grid, .services-grid");
                    grids.forEach(function(g) { g.style.gridTemplateColumns = "repeat(auto-fill, minmax(260px, 1fr))"; });
                    gsap.fromTo(leftPane.querySelectorAll(".card-clickable"),
                        { scale: 0.97, opacity: 0.85 },
                        { scale: 1, opacity: 1, duration: 0.35, stagger: 0.02, ease: "back.out(1.4)" }
                    );
                    isAnimating = false;
                }
            });
            syncBtnPosition();
        } else {
            workspace.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 1fr)";
            var grids = leftPane.querySelectorAll(".cards-grid, .nodes-grid, .services-grid");
            grids.forEach(function(g) { g.style.gridTemplateColumns = ""; });

            rightPane.style.display = "";
            gsap.fromTo(rightPane,
                { x: 90, opacity: 0, scale: 0.96 },
                {
                    x: 0, opacity: 1, scale: 1, duration: 0.48, ease: "power3.out",
                    onComplete: function() { isAnimating = false; syncBtnPosition(); }
                }
            );
            setTimeout(syncBtnPosition, 40);
        }
    }

    btn.onclick = function() { toggleMacCurtain(!isClosed); };
    window.openWorkspaceCurtain = function() { if (isClosed) toggleMacCurtain(false); };

    document.addEventListener("click", function(e) {
        if (!isClosed) return;
        if (e.target.closest(".card-clickable") || e.target.closest(".cm-dropdown-item") || e.target.closest("#btn-tls") || e.target.closest("#btn-about")) {
            toggleMacCurtain(false);
        }
    });

    // Evitar que los canvas de las gráficas deformen el 50/50 del grid
    workspace.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 1fr)";
    leftPane.style.minWidth = "0";
    rightPane.style.minWidth = "0";

    // Reacomodar la flecha automáticamente cada vez que el panel derecho cambie de tamaño
    if (typeof ResizeObserver !== "undefined") {
        var ro = new ResizeObserver(function() {
            if (!isAnimating) syncBtnPosition();
        });
        ro.observe(rightPane);
        ro.observe(workspace);
    }

    window.addEventListener("resize", syncBtnPosition);
    setTimeout(syncBtnPosition, 150);
})();


/* === TOOLTIP EN MEDIDAS DEL EJE AL PASAR EL CURSOR === */
(function initAxisUnitHover() {
    var tip = document.createElement("div");
    tip.id = "axis-unit-tooltip";
    tip.style.cssText = "position:fixed;z-index:10050;pointer-events:none;display:none;background:rgba(9,9,11,0.92);border:1px solid #22d3ee;color:#f4f4f5;padding:6px 10px;border-radius:8px;font-size:11px;box-shadow:0 8px 20px rgba(0,0,0,0.7);max-width:280px;";
    document.body.appendChild(tip);

    document.addEventListener("mousemove", function(e) {
        var cv = e.target;
        if (!cv || cv.tagName !== "CANVAS") { tip.style.display = "none"; return; }
        var chart = Chart.getChart(cv);
        if (!chart || !chart.scales || !chart.scales.y) { tip.style.display = "none"; return; }

        var rect = cv.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var yScale = chart.scales.y;

        // Solo activar si el cursor está sobre la columna de los números del eje Y
        if (x >= yScale.left && x <= yScale.right && y >= yScale.top && y <= yScale.bottom) {
            var key = cv.id === "knox-cinema-canvas" ? activeCinemaKey : cv.id.replace("srv-canvas-", "");
            var meta = (getActiveMeta()[key] || {});
            if (meta.unit) {
                tip.innerHTML = "<strong style='color:#22d3ee;'>Unidad: " + meta.unit + "</strong><br><span style='color:#a1a1aa;'>" + meta.desc + "</span>";
                tip.style.left = (e.clientX + 14) + "px";
                tip.style.top = (e.clientY - 12) + "px";
                tip.style.display = "block";
                return;
            }
        }
        tip.style.display = "none";
    });
})();


/* === MENÚ DESPLEGABLE ACCIONES (ESTILO PRIMEFACES + GSAP) === */
var isMainMenuOpen = false;

function toggleMainActionsMenu(e) {
    if (e) e.stopPropagation();
    if (isMainMenuOpen) {
        closeMainActionsMenu();
    } else {
        openMainActionsMenu();
    }
}

function openMainActionsMenu() {
    var menu = document.getElementById("cm-actions-menu");
    var caret = document.getElementById("cm-dropdown-caret");
    if (!menu || isMainMenuOpen) return;
    if (typeof closeAboutMenu === "function") closeAboutMenu();
    if (typeof closeAwsUserMenu === "function") closeAwsUserMenu();
    isMainMenuOpen = true;
    menu.style.display = "block";

    // Efecto despliegue PrimeFaces (desenrollado vertical + rebote sutil + stagger en opciones)
    gsap.killTweensOf(menu);
    gsap.fromTo(menu,
        { opacity: 0, scaleY: 0.78, y: -8 },
        { opacity: 1, scaleY: 1, y: 0, duration: 0.28, ease: "back.out(1.7)" }
    );
    gsap.fromTo(menu.querySelectorAll(".cm-dropdown-item"),
        { opacity: 0, x: -8 },
        { opacity: 1, x: 0, duration: 0.22, stagger: 0.05, ease: "power2.out" }
    );
    if (caret) gsap.to(caret, { rotation: 180, duration: 0.24, ease: "power2.out" });
}

function closeMainActionsMenu() {
    var menu = document.getElementById("cm-actions-menu");
    var caret = document.getElementById("cm-dropdown-caret");
    if (!menu || !isMainMenuOpen) return;
    isMainMenuOpen = false;

    gsap.killTweensOf(menu);
    gsap.to(menu, {
        opacity: 0,
        scaleY: 0.82,
        y: -6,
        duration: 0.18,
        ease: "power2.in",
        onComplete: function() { menu.style.display = "none"; }
    });
    if (caret) gsap.to(caret, { rotation: 0, duration: 0.2, ease: "power2.in" });
}

// Cerrar al hacer clic fuera o con ESC
document.addEventListener("click", function(e) {
    if (isMainMenuOpen && !e.target.closest("#cm-main-actions-dropdown")) {
        closeMainActionsMenu();
    }
});

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && isMainMenuOpen) {
        closeMainActionsMenu();
    }
});


/* === SCRIPT PARA EL REPORTE GENERAL DE MÉTRICAS DE USO === */
// El código completo para renderizar los 6 paneles verticales, la barra de progreso sticky, 
// la gráfica de tendencias HDFS con Chart.js, animaciones GSAP y la exportación a CSV 
// se encuentra disponible en la implementación de la aplicación.

/* === REPORTE GENERAL DE METRICAS DE USO (PARTE 1/2) === */
var _lastReportData = null;

function repBox(title, badge, bodyHtml) {
    return '<div class="rep-panel-card" style="background:#09090b;border:1px solid #27272a;border-radius:12px;padding:1rem;margin-bottom:0.9rem;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;border-bottom:1px solid #18181b;padding-bottom:0.5rem;">' +
        '<strong style="font-size:0.82rem;color:#22d3ee;text-transform:uppercase;letter-spacing:0.5px;">' + title + '</strong>' +
        '<span style="font-size:0.7rem;color:#a1a1aa;background:#18181b;padding:2px 8px;border-radius:6px;">' + badge + '</span></div>' +
        bodyHtml + '</div>';
}

function repKpi(label, val, sub, color) {
    return '<div style="background:#18181b;border:1px solid #27272a;border-radius:10px;padding:0.7rem;">' +
        '<div style="font-size:0.68rem;color:#a1a1aa;text-transform:uppercase;">' + label + '</div>' +
        '<div style="font-size:1.15rem;font-weight:800;color:' + (color || '#f4f4f5') + ';margin:3px 0;">' + val + '</div>' +
        '<div style="font-size:0.68rem;color:#71717a;">' + sub + '</div></div>';
}

async function inspectGeneralReport(days) {
    if (typeof window.openWorkspaceCurtain === "function") window.openWorkspaceCurtain();
    days = days || 7;
    if (typeof stopServiceMetrics === "function") stopServiceMetrics();
    if (typeof stopRoleMonitor === "function") stopRoleMonitor();
            if (typeof stopAppStorageMonitor === "function") stopAppStorageMonitor();
            var tb = document.getElementById("rep-scroll-top-btn"); if (tb) tb.style.display = "none";
    if (typeof stopCertMonitor === "function") stopCertMonitor();

    var dp = document.getElementById("detail-panel");
    if (!dp) return;
    dp.innerHTML = '<div style="padding:2rem;text-align:center;color:#22d3ee;">Cargando Reporte General (' + days + ' días)...</div>';

    try {
        var res = await fetch("/api/general-report?days=" + days);
        var d = await res.json();
        if (!d.ok) { dp.innerHTML = '<div style="color:#fb7185;padding:1rem;">Error cargando reporte</div>'; return; }
        _lastReportData = d;
        renderGeneralReport(dp, d, days);
    } catch (e) {
        dp.innerHTML = '<div style="color:#fb7185;padding:1rem;">Error de red: ' + e.message + '</div>';
    }
}

function renderGeneralReport(dp, d, days) {
    var k = d.kpis || {};
    var headerHtml = '<div style="position:sticky;top:0;z-index:20;background:rgba(9,9,11,0.95);backdrop-filter:blur(10px);padding:0.65rem 0;margin-bottom:0.8rem;border-bottom:1px solid #27272a;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<div><strong style="color:#f4f4f5;font-size:0.95rem;">Reporte General • ' + d.cluster + '</strong>' +
        '<div style="font-size:0.7rem;color:#a1a1aa;">Periodo: ' + d.period + '</div></div>' +
        '<div style="display:flex;gap:5px;align-items:center;">' +
        '<button type="button" class="knox-tab-btn ' + (days===7?'active':'') + '" onclick="inspectGeneralReport(7)">7d</button>' +
        '<button type="button" class="knox-tab-btn ' + (days===15?'active':'') + '" onclick="inspectGeneralReport(15)">15d</button>' +
        '<button type="button" class="knox-tab-btn ' + (days===30?'active':'') + '" onclick="inspectGeneralReport(30)">30d</button>' +
        '<button type="button" class="knox-tab-btn" style="border-color:#34d399!important;color:#34d399!important;" onclick="exportReportDocx()">⬇ Word</button>' +
        '</div></div>' +
        '<div style="height:4px;width:100%;background:#18181b;border-radius:4px;margin-top:8px;overflow:hidden;">' +
        '<div id="rep-scroll-bar" style="height:100%;width:15%;background:linear-gradient(90deg,#06b6d4,#a855f7);transition:width 0.12s;"></div></div></div>';

    var kpiGrid = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.6rem;margin-bottom:0.8rem;">' +
        repKpi("Disco HDFS Lógico", (k.total_logical_gb || 0) + " GB", "Sin replicación", "#22d3ee") +
        repKpi("Disco HDFS Raw", (k.total_raw_gb || 0) + " GB", "Con replicación ~3x", "#a855f7") +
        repKpi("1er Consumidor", k.top1_user || "N/A", (k.top1_gb || 0) + " GB (" + (k.top1_pct || 0) + "%)", "#34d399") +
        repKpi("2do Consumidor", k.top2_user || "N/A", (k.top2_gb || 0) + " GB (" + (k.top2_pct || 0) + "%)", "#fbbf24") +
        repKpi("Apps YARN", k.yarn_apps || 0, "Últimos " + days + " días", "#38bdf8") +
        repKpi("Queries Impala", k.impala_queries || 0, "Últimos " + days + " días", "#fb7185") +
        '</div>';

    var findHtml = '<ul style="margin:0;padding-left:1.1rem;color:#d4d4d8;font-size:0.78rem;line-height:1.5;">' +
        (d.findings || new Array()).map(function(f) { return '<li style="margin-bottom:4px;">' + f + '</li>'; }).join("") + '</ul>';

    dp.innerHTML = headerHtml +
        repBox("1. Resumen de Métricas Clave & Hallazgos", "KPIs Cluster", kpiGrid + findHtml) +
        buildPanels2To6(d);

    initReportScrollAndCharts(dp, d);
}

/* === REPORTE GENERAL DE METRICAS DE USO (PARTE 2/2) === */
function buildPanels2To6(d) {
    var uRows = (d.hdfs_users || new Array()).map(function(u) {
        return '<tr style="border-bottom:1px solid #18181b;">' +
            '<td style="padding:5px;color:#f4f4f5;font-weight:600;">' + u.user + '</td>' +
            '<td style="padding:5px;text-align:right;color:#22d3ee;">' + u.gb_logical + ' GB</td>' +
            '<td style="padding:5px;text-align:right;color:#a855f7;">' + u.gb_raw + ' GB</td>' +
            '<td style="padding:5px;text-align:right;color:#a1a1aa;">' + u.files + '</td>' +
            '<td style="padding:5px;text-align:right;color:#34d399;">' + u.pct + '%</td></tr>';
    }).join("") || '<tr><td colspan="5" style="padding:8px;color:#71717a;">Sin datos HDFS por usuario</td></tr>';

    var p2 = repBox("2. Uso Actual de Disco HDFS por Usuario", (d.hdfs_users || new Array()).length + " usuarios",
        '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.75rem;">' +
        '<thead><tr style="color:#a1a1aa;border-bottom:1px solid #27272a;"><th style="text-align:left;padding:5px;">Usuario</th><th style="text-align:right;padding:5px;">Lógico</th><th style="text-align:right;padding:5px;">Raw (~3x)</th><th style="text-align:right;padding:5px;">Archivos</th><th style="text-align:right;padding:5px;">% Total</th></tr></thead>' +
        '<tbody>' + uRows + '</tbody></table></div>');

    var p3 = repBox("3. Tendencia Histórica de Disco HDFS (GB Raw)", "Evolución diaria",
        '<div style="height:210px;width:100%;position:relative;"><canvas id="rep-hdfs-trend-canvas"></canvas></div>');

    var impRows = (d.impala || new Array()).map(function(r) {
        return '<tr style="border-bottom:1px solid #18181b;"><td style="padding:4px;">' + r.date + '</td><td style="text-align:right;color:#22d3ee;">' + r.queries + '</td><td style="text-align:right;color:#a1a1aa;">' + r.duration + ' ms</td></tr>';
    }).join("") || '<tr><td colspan="3" style="padding:6px;color:#71717a;">Sin actividad Impala en el periodo</td></tr>';

    var p4 = repBox("4. Actividad de Consultas Impala", "Diario",
        '<table style="width:100%;border-collapse:collapse;font-size:0.75rem;"><thead><tr style="color:#a1a1aa;border-bottom:1px solid #27272a;"><th style="text-align:left;padding:4px;">Fecha</th><th style="text-align:right;padding:4px;">Queries / día</th><th style="text-align:right;padding:4px;">Duración</th></tr></thead><tbody>' + impRows + '</tbody></table>');

    var yRows = (d.yarn || new Array()).map(function(r) {
        return '<tr style="border-bottom:1px solid #18181b;"><td style="padding:4px;">' + r.date + '</td><td style="text-align:right;color:#38bdf8;">' + r.apps + '</td><td style="text-align:right;color:#a1a1aa;">' + r.duration + ' s</td></tr>';
    }).join("") || '<tr><td colspan="3" style="padding:6px;color:#71717a;">Sin aplicaciones YARN en el periodo</td></tr>';

    var p5 = repBox("5. Actividad YARN (Aplicaciones)", "Diario",
        '<table style="width:100%;border-collapse:collapse;font-size:0.75rem;"><thead><tr style="color:#a1a1aa;border-bottom:1px solid #27272a;"><th style="text-align:left;padding:4px;">Fecha</th><th style="text-align:right;padding:4px;">Apps Ingeridas</th><th style="text-align:right;padding:4px;">Duración Total</th></tr></thead><tbody>' + yRows + '</tbody></table>');

    var hbRows = (d.hbase_tables || new Array()).slice(0, 15).map(function(t) {
        return '<tr style="border-bottom:1px solid #18181b;"><td style="padding:4px;color:#f4f4f5;">' + t.table + '</td><td style="padding:4px;color:#a1a1aa;">' + t.namespace + '</td><td style="text-align:right;color:#fbbf24;">' + t.mb + ' MB</td><td style="text-align:right;color:#34d399;">' + t.gets_day + '</td></tr>';
    }).join("") || '<tr><td colspan="4" style="padding:6px;color:#71717a;">Sin tablas HBase registradas</td></tr>';

    var p6 = repBox("6. Tablas HBase & Glosario", (d.hbase_tables || new Array()).length + " tablas",
        '<table style="width:100%;border-collapse:collapse;font-size:0.75rem;margin-bottom:0.7rem;"><thead><tr style="color:#a1a1aa;border-bottom:1px solid #27272a;"><th style="text-align:left;padding:4px;">Tabla</th><th style="text-align:left;padding:4px;">Namespace</th><th style="text-align:right;padding:4px;">Tamaño (MB)</th><th style="text-align:right;padding:4px;">Gets/día</th></tr></thead><tbody>' + hbRows + '</tbody></table>' +
        '<div style="font-size:0.7rem;color:#71717a;border-top:1px solid #18181b;padding-top:6px;"><strong>Glosario:</strong> Lógico = sin replicación • Raw = con factor de replicación HDFS (~3x) • counter_delta = incremento diario.</div>');

    return p2 + p3 + p4 + p5 + p6;
}

function initReportScrollAndCharts(dp, d) {
    // 1. Progress bar sticky al hacer scroll
    var scrollTarget = dp.parentElement || dp;
    function updateBar() {
        var bar = document.getElementById("rep-scroll-bar");
        if (!bar) return;
        var maxScroll = scrollTarget.scrollHeight - scrollTarget.clientHeight;
        var pct = maxScroll > 0 ? Math.min(100, Math.max(12, (scrollTarget.scrollTop / maxScroll) * 100)) : 100;
        bar.style.width = pct + "%";
    }
    scrollTarget.addEventListener("scroll", updateBar);
    updateBar();

    // 2. Animacion GSAP en cascada para los 6 paneles
    if (typeof gsap !== "undefined") {
        gsap.fromTo(dp.querySelectorAll(".rep-panel-card"),
            { opacity: 0, y: 14 },
            { opacity: 1, y: 0, duration: 0.32, stagger: 0.06, ease: "power2.out" }
        );
    }

    // 3. Grafica historica HDFS
    var cv = document.getElementById("rep-hdfs-trend-canvas");
    var tr = d.hdfs_trend || {};
    if (cv && tr.dates && tr.dates.length > 0 && typeof Chart !== "undefined") {
        var ds = (tr.series || new Array()).map(function(s, i) {
            var c = NODE_PALETTE.at(i % NODE_PALETTE.length);
            return { label: s.user, data: s.values, borderColor: c, backgroundColor: c + "22", borderWidth: 2, pointRadius: 2, tension: 0.3, fill: false };
        });
        new Chart(cv.getContext("2d"), {
            type: "line",
            data: { labels: tr.dates, datasets: ds },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#e4e4e7", boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: "#71717a", font: { size: 9 } }, grid: { color: "#18181b" } }, y: { beginAtZero: true, ticks: { color: "#a1a1aa", font: { size: 9 } }, grid: { color: "#27272a" } } } }
        });
    }
}




function exportReportDocx() {
    var d = (_lastReportData && _lastReportData.days) ? _lastReportData.days : 7;
    window.location.href = "/api/general-report/docx?days=" + encodeURIComponent(d);
}
function exportReportCsv() { return exportReportDocx(); }



/* === MENÚ ESTILO AWS + POPUP DETALLE USUARIO (GSAP) === */
var isAwsMenuOpen = false;

function toggleAwsUserMenu(e) {
    if (e) e.stopPropagation();
    isAwsMenuOpen ? closeAwsUserMenu() : openAwsUserMenu();
}

function openAwsUserMenu() {
    var menu = document.getElementById("cm-aws-user-menu");
    var caret = document.getElementById("aws-user-caret");
    if (!menu || isAwsMenuOpen) return;
    if (typeof closeMainActionsMenu === "function") closeMainActionsMenu();
    isAwsMenuOpen = true;
    menu.style.display = "block";
    gsap.killTweensOf(menu);
    gsap.fromTo(menu, { opacity: 0, scaleY: 0.8, y: -6 }, { opacity: 1, scaleY: 1, y: 0, duration: 0.24, ease: "back.out(1.6)" });
    if (caret) gsap.to(caret, { rotation: 180, duration: 0.2 });
}

function closeAwsUserMenu() {
    var menu = document.getElementById("cm-aws-user-menu");
    var caret = document.getElementById("aws-user-caret");
    if (!menu || !isAwsMenuOpen) return;
    isAwsMenuOpen = false;
    gsap.killTweensOf(menu);
    gsap.to(menu, { opacity: 0, scaleY: 0.85, y: -5, duration: 0.16, onComplete: function() { menu.style.display = "none"; } });
    if (caret) gsap.to(caret, { rotation: 0, duration: 0.18 });
}

document.addEventListener("click", function(e) {
    if (isAwsMenuOpen && !e.target.closest("#cm-aws-user-dropdown")) closeAwsUserMenu();
});

async function openUserDetailPopup() {
    closeUserDetailPopup(true);
    var ov = document.createElement("div");
    ov.id = "user-detail-overlay";
    ov.className = "glass-cinema-overlay";
    ov.onclick = function(e) { if (e.target === ov) closeUserDetailPopup(false); };
    ov.innerHTML = '<div id="user-detail-modal" class="glass-cinema-modal" style="max-width:480px;padding:1.4rem;">' +
        '<div class="glass-cinema-header"><span class="glass-cinema-title">👤 Detalle de Usuario Activo</span>' +
        '<button type="button" class="glass-close-btn" onclick="closeUserDetailPopup(false)">✕</button></div>' +
        '<div id="user-detail-body" style="color:#a1a1aa;font-size:0.85rem;padding:0.5rem 0;">Consultando sesión...</div></div>';
    document.body.appendChild(ov);

    var md = document.getElementById("user-detail-modal");
    gsap.fromTo(ov, { opacity: 0 }, { opacity: 1, duration: 0.2 });
    gsap.fromTo(md, { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "power3.out" });

    try {
        var r = await fetch("/api/user-session");
        var d = await r.json();
        var body = document.getElementById("user-detail-body");
        if (!body) return;
        var lbl = document.getElementById("aws-user-label");
        if (lbl && d.username) lbl.textContent = d.username;

        body.innerHTML = '<div style="display:flex;flex-direction:column;gap:0.65rem;">' +
            '<div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:0.75rem;">' +
            '<div style="font-size:0.7rem;color:#71717a;text-transform:uppercase;">Usuario Autenticado</div>' +
            '<div style="font-size:1.05rem;font-weight:800;color:#22d3ee;margin-top:2px;">' + (d.username || "Admin") + '</div></div>' +
            '<div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:0.75rem;">' +
            '<div style="font-size:0.7rem;color:#71717a;text-transform:uppercase;">Clúster Administrado</div>' +
            '<div style="font-size:0.92rem;font-weight:700;color:#f4f4f5;margin-top:2px;">' + (d.cluster || "Quintana Roo") + '</div></div>' +
            '<div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:0.75rem;">' +
            '<div style="font-size:0.7rem;color:#71717a;text-transform:uppercase;">Endpoint Cloudera Manager</div>' +
            '<div style="font-size:0.85rem;font-family:monospace;color:#34d399;margin-top:2px;">' + (d.cm_url || "") + '</div></div>' +
            '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:0.5rem;">' +
            '<button type="button" class="knox-tab-btn" onclick="closeUserDetailPopup(false)">Cerrar</button>' +
            '' +
            '</div></div>';
    } catch (e) {
        var bErr = document.getElementById("user-detail-body");
        if (bErr) bErr.textContent = "Error obteniendo detalles de sesión.";
    }
}

function closeUserDetailPopup(imm) {
    var ov = document.getElementById("user-detail-overlay"), md = document.getElementById("user-detail-modal");
    if (!ov) return;
    function del() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
    if (imm || !md) { del(); }
    else {
        gsap.to(md, { scale: 0.85, opacity: 0, duration: 0.2, ease: "power2.in" });
        gsap.to(ov, { opacity: 0, duration: 0.2, onComplete: del });
    }
}

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        if (isAwsMenuOpen) closeAwsUserMenu();
        if (document.getElementById("user-detail-overlay")) closeUserDetailPopup(false);
    }
});


/* === MENU DESPLEGABLE ACERCA DE + MONITOR DE LOGS Y METADATOS === */
var isAboutMenuOpen = false;

function toggleAboutMenu(e) {
    if (e) e.stopPropagation();
    isAboutMenuOpen ? closeAboutMenu() : openAboutMenu();
}

function openAboutMenu() {
    var menu = document.getElementById("cm-about-menu");
    var caret = document.getElementById("cm-about-caret");
    if (!menu || isAboutMenuOpen) return;
    if (typeof closeMainActionsMenu === "function") closeMainActionsMenu();
    if (typeof closeAwsUserMenu === "function") closeAwsUserMenu();
    isAboutMenuOpen = true;
    menu.style.display = "block";
    gsap.killTweensOf(menu);
    gsap.fromTo(menu, { opacity: 0, scaleY: 0.78, y: -8 }, { opacity: 1, scaleY: 1, y: 0, duration: 0.26, ease: "back.out(1.7)" });
    if (caret) gsap.to(caret, { rotation: 180, duration: 0.22 });
}

function closeAboutMenu() {
    var menu = document.getElementById("cm-about-menu");
    var caret = document.getElementById("cm-about-caret");
    if (!menu || !isAboutMenuOpen) return;
    isAboutMenuOpen = false;
    gsap.killTweensOf(menu);
    gsap.to(menu, { opacity: 0, scaleY: 0.82, y: -6, duration: 0.16, onComplete: function() { menu.style.display = "none"; } });
    if (caret) gsap.to(caret, { rotation: 0, duration: 0.18 });
}

document.addEventListener("click", function(e) {
    if (isAboutMenuOpen && !e.target.closest("#cm-about-dropdown")) closeAboutMenu();
});

var appStorageTimer = null;
var isStorageAutoOn = false;

function stopAppStorageMonitor() {
    isStorageAutoOn = false;
    if (appStorageTimer) {
        clearInterval(appStorageTimer);
        appStorageTimer = null;
    }
}

function toggleAppStorageAuto(checked) {
    isStorageAutoOn = !!checked;
    if (appStorageTimer) {
        clearInterval(appStorageTimer);
        appStorageTimer = null;
    }
    var badge = document.getElementById("storage-auto-badge");
    if (isStorageAutoOn) {
        if (badge) { badge.textContent = "● 30s"; badge.style.color = "#34d399"; }
        appStorageTimer = setInterval(async function() {
            if (!isStorageAutoOn || !document.getElementById("mac-storage-list")) {
                stopAppStorageMonitor();
                return;
            }
            try {
                var r = await fetch("/api/app-storage");
                var d = await r.json();
                var dp = document.getElementById("detail-panel");
                if (d.ok && dp && document.getElementById("mac-storage-list")) {
                    renderMacStoragePanel(dp, d, true);
                }
            } catch (e) {}
        }, 30000);
    } else {
        if (badge) { badge.textContent = "Manual"; badge.style.color = "#71717a"; }
    }
}

async function inspectAppStorage() {
    if (typeof window.openWorkspaceCurtain === "function") window.openWorkspaceCurtain();
    if (typeof stopServiceMetrics === "function") stopServiceMetrics();
    if (typeof stopRoleMonitor === "function") stopRoleMonitor();
    if (typeof stopCertMonitor === "function") stopCertMonitor();
    stopAppStorageMonitor();

    var dp = document.getElementById("detail-panel");
    if (!dp) return;
    dp.innerHTML = "<div style='padding:2rem;text-align:center;color:#22d3ee;'>Escaneando carpetas y metadatos...</div>";

    try {
        var res = await fetch("/api/app-storage");
        var d = await res.json();
        renderMacStoragePanel(dp, d, false);
    } catch (e) {
        dp.innerHTML = "<div style='color:#fb7185;padding:1rem;'>Error: " + e.message + "</div>";
    }
}

function renderMacStoragePanel(dp, d, skipAnim) {
    var items = d.items || new Array();
    var maxBytes = items.reduce(function(acc, it) { return Math.max(acc, it.total_bytes || 0); }, 1);
    var chkAttr = isStorageAutoOn ? "checked" : "";
    var badgeTxt = isStorageAutoOn ? "● 30s" : "Manual";
    var badgeClr = isStorageAutoOn ? "#34d399" : "#71717a";

    // Capturar porcentajes actuales antes de repintar para animar la bajada en tiempo real
    var prevPcts = {};
    dp.querySelectorAll(".mac-storage-bar").forEach(function(b) {
        var id = b.getAttribute("data-id");
        if (id) prevPcts[id] = b.style.width || "0%";
    });

    var header = "<div style='display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid #27272a;'>" +
        "<div><strong style='color:#f4f4f5;font-size:0.95rem;'>Monitor de Logs y Metadatos</strong>" +
        "<div style='font-size:0.72rem;color:#a1a1aa;margin-top:2px;'>Basura detectada: <strong style='color:#22d3ee;'>" + (d.total_junk_hr || "0 B") + "</strong></div></div>" +
        "<div style='display:flex;align-items:center;gap:10px;'>" +
        "<label style='display:inline-flex;align-items:center;gap:6px;background:#09090b;border:1px solid #27272a;padding:4px 9px;border-radius:8px;cursor:pointer;font-size:0.72rem;color:#a1a1aa;' title='Activar refresco automático cada 30 segundos'>" +
        "<span id='storage-auto-badge' style='font-weight:700;color:" + badgeClr + ";'>" + badgeTxt + "</span>" +
        "<input type='checkbox' " + chkAttr + " onchange='toggleAppStorageAuto(this.checked)' style='accent-color:#06b6d4;cursor:pointer;margin:0;'>" +
        "</label>" +
        "<button type='button' class='knox-tab-btn' style='border-color:#fb7185!important;color:#fb7185!important;' onclick=\"triggerCleanStorage('all')\">🧹 Limpiar Todo</button>" +
        "</div></div>";

    var rowsHtml = items.map(function(it) {
        var barPct = Math.max(4, Math.round(((it.total_bytes || 0) / maxBytes) * 100));
        var targetW = barPct + "%";
        var startW = prevPcts[it.id] || targetW;

        var junkTag = it.can_clean
            ? "<span style='font-size:0.68rem;color:#fbbf24;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);padding:1px 6px;border-radius:5px;margin-left:8px;'>basura: " + it.junk_hr + "</span>"
            : "<span style='font-size:0.68rem;color:#34d399;margin-left:8px;'>limpio</span>";

        var cleanBtn = it.can_clean
            ? "<button type='button' class='knox-tab-btn' style='padding:4px 10px!important;font-size:0.72rem!important;border-color:#22d3ee!important;color:#22d3ee!important;' onclick=\"triggerCleanStorage('" + it.id + "')\">Limpiar</button>"
            : "<span style='font-size:0.72rem;color:#52525b;padding:4px 10px;'>OK</span>";

        return "<div class='mac-storage-row' data-row-id='" + it.id + "' style='background:#09090b;border:1px solid #27272a;border-radius:11px;padding:0.75rem 0.95rem;margin-bottom:0.65rem;display:flex;align-items:center;justify-content:space-between;gap:12px;'>" +
            "<div style='flex:1;min-width:0;'>" +
            "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;'>" +
            "<div style='display:flex;align-items:center;gap:8px;'><span>📁</span><strong style='font-family:monospace;font-size:0.84rem;color:#f4f4f5;'>" + it.label + "</strong>" + junkTag + "</div>" +
            "<span class='mac-storage-size' style='font-family:monospace;font-size:0.82rem;font-weight:700;color:#22d3ee;'>" + it.total_hr + "</span></div>" +
            "<div style='height:5px;width:100%;background:#18181b;border-radius:4px;overflow:hidden;'>" +
            "<div class='mac-storage-bar' data-id='" + it.id + "' data-target-w='" + targetW + "' style='height:100%;width:" + startW + ";background:linear-gradient(90deg,#06b6d4,#a855f7);border-radius:4px;'></div></div></div>" +
            "<div style='flex-shrink:0;'>" + cleanBtn + "</div></div>";
    }).join("");

    dp.innerHTML = header + "<div id='mac-storage-list'>" + rowsHtml + "</div>" + "<div style='margin-top:0.85rem;padding-top:0.75rem;border-top:1px solid #27272a;display:flex;justify-content:space-between;align-items:center;'><span style='font-size:0.72rem;color:#71717a;'>Motor de rastreo SQLite activo</span><button type='button' class='knox-tab-btn' style='border-color:rgba(34,211,238,0.45)!important;color:#22d3ee!important;' onclick='openRulesPopup()'>⚙ Configurar Archivos / Extensiones Rastreadas</button></div>";

    if (typeof gsap !== "undefined") {
        if (!skipAnim) {
            gsap.fromTo(dp.querySelectorAll(".mac-storage-row"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, stagger: 0.04, ease: "power2.out" });
        }
        // Animar cada barra desde su ancho anterior hasta el nuevo ancho real
        dp.querySelectorAll(".mac-storage-bar").forEach(function(bar) {
            var fromW = bar.style.width;
            var toW = bar.getAttribute("data-target-w");
            if (fromW !== toW) {
                gsap.fromTo(bar, { width: fromW }, { width: toW, duration: 0.65, ease: "power3.out" });
                var row = bar.closest(".mac-storage-row");
                if (row) {
                    gsap.fromTo(row, { borderColor: "#34d399" }, { borderColor: "#27272a", duration: 0.9, ease: "power2.out" });
                }
            } else if (!skipAnim) {
                gsap.fromTo(bar, { width: "0%" }, { width: toW, duration: 0.55, ease: "power2.out" });
            }
        });
    }
}

async function triggerCleanStorage(targetId) {
    try {
        var res = await fetch("/api/app-storage/clean", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: targetId })
        });
        var d = await res.json();
        var dp = document.getElementById("detail-panel");
        if (d.ok && d.scan && dp) renderMacStoragePanel(dp, d.scan, true);
    } catch (e) {
        alert("Error limpiando: " + e.message);
    }
}


/* === POPUP DE REGLAS SQLITE DE METADATOS === */
var _protectedMap = {};

async function openRulesPopup() {
    closeRulesPopup(true);
    var ov = document.createElement("div");
    ov.id = "rules-popup-overlay";
    ov.className = "glass-cinema-overlay";
    ov.onclick = function(e) { if (e.target === ov) closeRulesPopup(false); };
    ov.innerHTML = "<div id='rules-popup-modal' class='glass-cinema-modal' style='max-width:680px;max-height:86vh;overflow-y:auto;padding:1.4rem;'>" +
        "<div class='glass-cinema-header'><span class='glass-cinema-title'>⚙ Reglas de Rastreo SQLite (Metadata Elegible)</span>" +
        "<button type='button' class='glass-close-btn' onclick='closeRulesPopup(false)'>✕</button></div>" +
        "<p style='font-size:0.78rem;color:#a1a1aa;margin-bottom:0.85rem;'>Si el escáner encuentra archivos que coincidan con estas reglas en SQLite, los marca como metadata elegible para borrar.</p>" +
        "<div id='rules-warning-banner' style='display:none;background:rgba(244,63,94,0.14);border:1px solid #f43f5e;border-left:4px solid #f43f5e;border-radius:10px;padding:0.75rem;margin-bottom:0.85rem;color:#fecdd3;font-size:0.78rem;'></div>" +
        "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1rem;background:#09090b;padding:0.75rem;border-radius:10px;border:1px solid #27272a;'>" +
        "<input id='new-rule-pattern' type='text' placeholder='Ej. *.tmp, *.old, .DS_Store' oninput='checkProtectedExt(this.value)' style='flex:1;min-width:160px;background:#18181b;border:1px solid #27272a;color:#f4f4f5;padding:6px 10px;border-radius:8px;font-size:0.8rem;'>" +
        "<select id='new-rule-type' style='background:#18181b;border:1px solid #27272a;color:#e4e4e7;padding:6px 8px;border-radius:8px;font-size:0.8rem;'><option value='extension'>Extensión</option><option value='folder'>Carpeta</option><option value='file'>Archivo</option></select>" +
        "<input id='new-rule-desc' type='text' placeholder='Descripción breve' style='flex:1;min-width:140px;background:#18181b;border:1px solid #27272a;color:#f4f4f5;padding:6px 10px;border-radius:8px;font-size:0.8rem;'>" +
        "<button type='button' class='knox-tab-btn' style='border-color:#34d399!important;color:#34d399!important;' onclick='saveNewCleanupRule()'>+ Agregar</button></div>" +
        "<div id='rules-table-wrap' style='font-size:0.8rem;color:#a1a1aa;'>Cargando reglas desde SQLite...</div></div>";
    document.body.appendChild(ov);

    var md = document.getElementById("rules-popup-modal");
    gsap.fromTo(ov, { opacity: 0 }, { opacity: 1, duration: 0.2 });
    gsap.fromTo(md, { scale: 0.88, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: "power3.out" });

    var r = await fetch("/api/app-storage/rules");
    var d = await r.json();
    _protectedMap = d.protected || {};
    renderRulesTable(d.rules || new Array());
}

function checkProtectedExt(val) {
    var banner = document.getElementById("rules-warning-banner");
    if (!banner) return;
    var v = String(val || "").trim().toLowerCase();
    var matchedExt = Object.keys(_protectedMap).find(function(ext) {
        return v === ext || v === "*" + ext || v.endsWith(ext);
    });
    if (matchedExt) {
        var info = _protectedMap[matchedExt];
        banner.style.display = "block";
        banner.innerHTML = "<strong style='color:#fb7185;'>⚠ ADVERTENCIA DE RIESGO (" + info.risk_level + ") — Extensión protegida " + matchedExt + ":</strong><br>" + info.consequence;
    } else {
        banner.style.display = "none";
    }
}


function renderRulesTable(rules) {
    var wrap = document.getElementById("rules-table-wrap");
    if (!wrap) return;
    var rows = rules.map(function(r) {
        return "<tr style='border-bottom:1px solid #18181b;'>" +
            "<td style='padding:6px;color:#71717a;font-family:monospace;'>#" + r.id + "</td>" +
            "<td style='padding:6px;color:#22d3ee;font-family:monospace;font-weight:700;'>" + r.pattern + "</td>" +
            "<td style='padding:6px;color:#a1a1aa;'>" + r.rule_type + "</td>" +
            "<td style='padding:6px;color:#d4d4d8;'>" + (r.description || "") + "</td>" +
            "<td style='padding:6px;text-align:right;'><button type='button' class='knox-tab-btn' style='padding:2px 8px!important;font-size:0.7rem!important;border-color:#fb7185!important;color:#fb7185!important;' onclick='removeCleanupRule(" + r.id + ")'>Quitar</button></td></tr>";
    }).join("");
    wrap.innerHTML = "<table style='width:100%;border-collapse:collapse;font-size:0.76rem;'>" +
        "<thead><tr style='color:#a1a1aa;border-bottom:1px solid #27272a;'><th style='text-align:left;padding:6px;'>ID</th><th style='text-align:left;padding:6px;'>Patrón / Ext</th><th style='text-align:left;padding:6px;'>Tipo</th><th style='text-align:left;padding:6px;'>Descripción</th><th style='text-align:right;padding:6px;'>Acción</th></tr></thead>" +
        "<tbody>" + rows + "</tbody></table>";
}

async function saveNewCleanupRule() {
    var pat = document.getElementById("new-rule-pattern").value;
    var rtype = document.getElementById("new-rule-type").value;
    var desc = document.getElementById("new-rule-desc").value;
    if (!pat) return;

    var v = pat.trim().toLowerCase();
    var isCrit = Object.keys(_protectedMap).some(function(ext) { return v === ext || v === "*" + ext || v.endsWith(ext); });
    if (isCrit && !confirm("ATENCIÓN: Esta extensión está marcada en SQLite como crítica para la aplicación. ¿Seguro que deseas agregarla como borrable?")) {
        return;
    }

    var res = await fetch("/api/app-storage/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: pat, rule_type: rtype, scope: "app/*", description: desc })
    });
    var d = await res.json();
    if (d.ok) {
        document.getElementById("new-rule-pattern").value = "";
        document.getElementById("new-rule-desc").value = "";
        checkProtectedExt("");
        renderRulesTable(d.rules || new Array());
        var sr = await fetch("/api/app-storage");
        var sd = await sr.json();
        var dp = document.getElementById("detail-panel");
        if (sd.ok && dp && document.getElementById("mac-storage-list")) renderMacStoragePanel(dp, sd, true);
    }
}

async function removeCleanupRule(id) {
    var res = await fetch("/api/app-storage/rules?id=" + id, { method: "DELETE" });
    var d = await res.json();
    if (d.ok) {
        renderRulesTable(d.rules || new Array());
        var sr = await fetch("/api/app-storage");
        var sd = await sr.json();
        var dp = document.getElementById("detail-panel");
        if (sd.ok && dp && document.getElementById("mac-storage-list")) renderMacStoragePanel(dp, sd, true);
    }
}

function closeRulesPopup(imm) {
    var ov = document.getElementById("rules-popup-overlay"), md = document.getElementById("rules-popup-modal");
    if (!ov) return;
    function del() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
    if (imm || !md) del();
    else { gsap.to(md, { scale: 0.85, opacity: 0, duration: 0.18 }); gsap.to(ov, { opacity: 0, duration: 0.18, onComplete: del }); }
}


/* === MODULO NODO: HARDWARE EN VIVO + ROLES FILTRABLES === */
var _nodeHwTimer = null;
var _renderedNodeKey = "";

function _ensureNodeHwTooltip() {
    var tip = document.getElementById("node-hw-tooltip");
    if (tip) return tip;
    tip = document.createElement("div");
    tip.id = "node-hw-tooltip";
    tip.style.cssText = "position:fixed;z-index:10060;pointer-events:none;display:none;background:rgba(9,9,11,0.94);border:1px solid #22d3ee;color:#f4f4f5;padding:7px 11px;border-radius:9px;font-size:11px;box-shadow:0 10px 24px rgba(0,0,0,0.75);max-width:290px;line-height:1.4;";
    document.body.appendChild(tip);

    document.addEventListener("mousemove", function(e) {
        var row = e.target.closest ? e.target.closest(".node-hw-row") : null;
        if (!row) { tip.style.display = "none"; return; }
        tip.innerHTML = "<strong style='color:#22d3ee;'>" + row.getAttribute("data-tip-title") + " (" + row.getAttribute("data-tip-unit") + ")</strong><br><span style='color:#d4d4d8;'>" + row.getAttribute("data-tip-desc") + "</span>";
        tip.style.left = (e.clientX + 14) + "px";
        tip.style.top = (e.clientY - 14) + "px";
        tip.style.display = "block";
    });
    return tip;
}

function _renderNodeHwRows(container, d) {
    _ensureNodeHwTooltip();
    var prevW = {};
    container.querySelectorAll(".node-hw-bar").forEach(function(b) {
        prevW[b.getAttribute("data-k")] = b.style.width || "0%";
    });

    var netTotal = (d.net_rx_mb || 0) + (d.net_tx_mb || 0);
    var netPct = Math.min(100, Math.max(4, Math.round((netTotal / 100) * 100)));

    var metrics = [
        { k: "cpu", icon: "⚡", label: "CPU Usado", valTxt: d.cpu_pct + " %", pct: Math.min(100, Math.max(3, Math.round(d.cpu_pct))), unit: "% de vCPU", desc: "Porcentaje total de cómputo consumido en los núcleos virtuales." },
        { k: "ram", icon: "🧠", label: "RAM Física", valTxt: d.ram_used_gb + " / " + d.ram_total_gb + " GB (" + d.ram_pct + "%)", pct: Math.min(100, Math.max(3, Math.round(d.ram_pct))), unit: "Gigabytes (GB)", desc: "Memoria RAM física ocupada vs capacidad total instalada." },
        { k: "disk", icon: "💾", label: "Disco Local", valTxt: d.disk_used_gb + " / " + d.disk_cap_gb + " GB (" + d.disk_pct + "%)", pct: Math.min(100, Math.max(3, Math.round(d.disk_pct))), unit: "Gigabytes (GB)", desc: "Almacenamiento ocupado en los filesystems locales del nodo." },
        { k: "net", icon: "🌐", label: "Tráfico Red I/O", valTxt: "↓ " + d.net_rx_mb + " MB/s • ↑ " + d.net_tx_mb + " MB/s", pct: netPct, unit: "MB/s", desc: "Tasa instantánea de recepción (↓ RX) y transmisión (↑ TX)." }
    ];

    container.innerHTML = metrics.map(function(m) {
        var targetW = m.pct + "%", startW = prevW[m.k] || "0%";
        return "<div class='node-hw-row' data-tip-title='" + m.label + "' data-tip-unit='" + m.unit + "' data-tip-desc='" + m.desc + "' style='background:#09090b;border:1px solid #27272a;border-radius:10px;padding:0.65rem 0.85rem;margin-bottom:0.55rem;cursor:help;'>" +
            "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;'>" +
            "<div style='display:flex;align-items:center;gap:7px;'><span>" + m.icon + "</span><strong style='font-family:monospace;font-size:0.8rem;color:#f4f4f5;'>" + m.label + "</strong></div>" +
            "<span style='font-family:monospace;font-size:0.78rem;font-weight:700;color:#22d3ee;'>" + m.valTxt + "</span></div>" +
            "<div style='height:5px;width:100%;background:#18181b;border-radius:4px;overflow:hidden;'>" +
            "<div class='node-hw-bar' data-k='" + m.k + "' data-target-w='" + targetW + "' style='height:100%;width:" + startW + ";background:linear-gradient(90deg,#06b6d4,#a855f7);border-radius:4px;'></div></div></div>";
    }).join("");

    if (typeof gsap !== "undefined") {
        container.querySelectorAll(".node-hw-bar").forEach(function(b) {
            gsap.to(b, { width: b.getAttribute("data-target-w"), duration: 0.65, ease: "power3.out" });
        });
    }
}


function _fetchAndPaintNodeHw(hostShort, liveDiv) {
    fetch("/api/node-metrics?host=" + encodeURIComponent(hostShort))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!document.body.contains(liveDiv)) return;
            if (d.ok) _renderNodeHwRows(liveDiv, d);
            else liveDiv.innerHTML = "<div style='font-size:0.72rem;color:#fbbf24;'>Sin telemetría disponible: " + (d.error || "") + "</div>";
        })
        .catch(function() {});
}

function runNodeEnhancer() {
    var dp = document.getElementById("detail-panel");
    if (!dp) return;
    var boxes = dp.querySelectorAll(".host-box");
    if (boxes.length < 2) {
        if (_nodeHwTimer) { clearInterval(_nodeHwTimer); _nodeHwTimer = null; _renderedNodeKey = ""; }
        return;
    }

    var headText = (dp.firstElementChild ? dp.firstElementChild.textContent : "") || "";
    var m = headText.match(/NODO\s*•\s*([a-zA-Z0-9._-]+)/i);
    if (!m) return;
    var hostShort = (typeof currentHostId !== "undefined" && currentHostId) ? currentHostId : m.pop().trim().toLowerCase();

    if (_renderedNodeKey == hostShort && document.getElementById("node-live-hw-box") && document.getElementById("node-roles-filter-bar")) {
        return;
    }
    _renderedNodeKey = hostShort;

    // 1. Barras de Hardware en vivo en la primera .host-box
    var hwBox = boxes.item(0);
    var liveDiv = document.getElementById("node-live-hw-box");
    if (!liveDiv) {
        liveDiv = document.createElement("div");
        liveDiv.id = "node-live-hw-box";
        liveDiv.style.cssText = "margin-top:0.85rem;padding-top:0.85rem;border-top:1px solid #27272a;";
        liveDiv.innerHTML = "<div style='font-size:0.72rem;color:#22d3ee;'>Consultando telemetría de hardware...</div>";
        hwBox.appendChild(liveDiv);
    }
    _fetchAndPaintNodeHw(hostShort, liveDiv);

    if (_nodeHwTimer) clearInterval(_nodeHwTimer);
    _nodeHwTimer = setInterval(function() {
        var curDiv = document.getElementById("node-live-hw-box");
        if (!curDiv || _renderedNodeKey != hostShort) { clearInterval(_nodeHwTimer); _nodeHwTimer = null; return; }
        _fetchAndPaintNodeHw(hostShort, curDiv);
    }, 5000);

    // 2. Filtro Todos / Solo Daemons y controles por rol en la segunda .host-box
    var rolesBox = boxes.item(1);
    if (rolesBox && !rolesBox.querySelector("#node-roles-filter-bar")) {
        var titleEl = rolesBox.firstElementChild;
        var bar = document.createElement("div");
        bar.id = "node-roles-filter-bar";
        bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:0.65rem;flex-wrap:wrap;";
        rolesBox.insertBefore(bar, titleEl);
        bar.appendChild(titleEl);

        var btns = document.createElement("div");
        btns.style.cssText = "display:inline-flex;gap:5px;";
        btns.innerHTML =
            "<button type='button' id='btn-filter-all-roles' class='knox-tab-btn active' style='padding:3px 9px!important;font-size:0.7rem!important;' onclick=\"filterNodeRoles('all')\">Todos</button>" +
            "<button type='button' id='btn-filter-daemons' class='knox-tab-btn' style='padding:3px 9px!important;font-size:0.7rem!important;' onclick=\"filterNodeRoles('daemons')\">Solo Daemons</button>";
        bar.appendChild(btns);

        Array.from(rolesBox.children).forEach(function(row) {
            if (row === bar) return;
            var txt = (row.textContent || "").trim();
            var op = txt.indexOf("("), cp = txt.indexOf(")");
            if (op == -1 || cp == -1) return;
            var roleType = txt.slice(0, op).trim();
            var srvName = txt.slice(op + 1, cp).trim();
            var isGw = roleType.indexOf("GATEWAY") != -1 || /\bNA\b/.test(txt);

            row.setAttribute("data-node-role-row", "1");
            row.setAttribute("data-is-gateway", isGw ? "1" : "0");

            if (!isGw && !row.querySelector(".node-role-actions")) {
                var ctrl = document.createElement("span");
                ctrl.className = "node-role-actions";
                ctrl.style.cssText = "display:inline-flex;gap:4px;margin-left:8px;";
                ctrl.innerHTML =
                    "<button type='button' title='Iniciar' onclick=\"execNodeRoleCmd(event,'" + hostShort + "','" + srvName + "','" + roleType + "','start')\" style='width:22px!important;height:22px!important;padding:0!important;background:#18181b!important;color:#34d399!important;border:1px solid #27272a!important;border-radius:5px!important;font-size:0.65rem!important;cursor:pointer;'>▶</button>" +
                    "<button type='button' title='Detener' onclick=\"execNodeRoleCmd(event,'" + hostShort + "','" + srvName + "','" + roleType + "','stop')\" style='width:22px!important;height:22px!important;padding:0!important;background:#18181b!important;color:#fb7185!important;border:1px solid #27272a!important;border-radius:5px!important;font-size:0.65rem!important;cursor:pointer;'>■</button>" +
                    "<button type='button' title='Reiniciar' onclick=\"execNodeRoleCmd(event,'" + hostShort + "','" + srvName + "','" + roleType + "','restart')\" style='width:22px!important;height:22px!important;padding:0!important;background:#18181b!important;color:#22d3ee!important;border:1px solid #27272a!important;border-radius:5px!important;font-size:0.72rem!important;cursor:pointer;'>↻</button>";
                row.appendChild(ctrl);
            }
        });
    }
}

function filterNodeRoles(mode) {
    var dp = document.getElementById("detail-panel");
    if (!dp) return;
    var bAll = document.getElementById("btn-filter-all-roles");
    var bDae = document.getElementById("btn-filter-daemons");
    if (bAll) bAll.classList.toggle("active", mode == "all");
    if (bDae) bDae.classList.toggle("active", mode == "daemons");
    dp.querySelectorAll("[data-node-role-row='1']").forEach(function(r) {
        r.style.display = (mode == "daemons" && r.getAttribute("data-is-gateway") == "1") ? "none" : "";
    });
}

async function execNodeRoleCmd(e, host, service, roleType, action) {
    if (e) e.stopPropagation();
    var labels = { start: "INICIAR", stop: "DETENER", restart: "REINICIAR" };
    if (!confirm("¿Confirmas " + (labels[action] || action) + " " + roleType + " (" + service + ") en " + host + "?")) return;
    var btn = e ? e.currentTarget : null;
    if (btn) { btn.style.opacity = "0.4"; btn.disabled = true; }
    try {
        var res = await fetch("/api/node-role-action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host: host, service: service, role_type: roleType, action: action })
        });
        var d = await res.json();
        alert(d.ok ? ("Orden '" + action + "' enviada a " + roleType + " en " + host + ".") : ("Error: " + (d.error || "Desconocido")));
    } catch (err) {
        alert("Error de red: " + err.message);
    } finally {
        if (btn) { btn.style.opacity = "1"; btn.disabled = false; }
    }
}

setInterval(runNodeEnhancer, 450);

/* === CONTROL GRANULAR POR INSTANCIA (SIN COMILLAS ESCAPADAS) === */
var _roleWatchTimers = {};

function triggerSingleRoleBtn(btn) {
    var rName = btn.getAttribute("data-rname");
    var rType = btn.getAttribute("data-rtype");
    var rHost = btn.getAttribute("data-rhost");
    var rAct = btn.getAttribute("data-ract");
    triggerSingleRoleCmd(rName, rType, rHost, rAct);
}

async function triggerSingleRoleCmd(roleName, roleType, hostname, action) {
    if (!currentCluster || !currentService) return;
    var labels = { start: "INICIAR", stop: "DETENER", restart: "REINICIAR" };
    if (!confirm("¿Confirmas " + (labels[action] || action) + " la instancia " + roleType + " en " + hostname + "?")) return;

    var slotId = "role-ctrl-" + roleName.replace(/[^a-zA-Z0-9_-]/g, "_");
    var slot = document.getElementById(slotId);
    if (slot) {
        slot.innerHTML = "<div style='display:inline-flex;align-items:center;gap:6px;margin-top:6px;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.35);padding:3px 9px;border-radius:7px;'>" +
            "<span class='worm-loader'><span class='worm-dot'></span><span class='worm-dot'></span><span class='worm-dot'></span></span>" +
            "<span style='font-size:0.68rem;font-weight:800;color:#22d3ee;'>ENVIANDO...</span></div>";
    }

    try {
        var res = await fetch("/api/role-command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                cluster: currentCluster,
                service: currentService,
                role_name: roleName,
                role_type: roleType,
                hostname: hostname,
                action: action
            })
        });
        var d = await res.json();
        if (!d.ok) {
            alert("Error: " + (d.error || "No se pudo ejecutar"));
            loadServiceRoles(true);
            return;
        }
        watchSingleRoleCommand(roleName, d.commandId, action);
    } catch (e) {
        alert("Error de red: " + e.message);
        loadServiceRoles(true);
    }
}

function watchSingleRoleCommand(roleName, cmdId, action) {
    if (!cmdId) return;
    if (_roleWatchTimers[roleName]) clearTimeout(_roleWatchTimers[roleName]);

    var actLabels = { start: "INICIANDO...", stop: "DETENIENDO...", restart: "REINICIANDO..." };
    var slotId = "role-ctrl-" + roleName.replace(/[^a-zA-Z0-9_-]/g, "_");

    async function pollOne() {
        var slot = document.getElementById(slotId);
        if (!slot) {
            delete _roleWatchTimers[roleName];
            return;
        }
        try {
            var r = await fetch("/api/command-status/" + cmdId);
            var st = await r.json();
            if (!st.ok) return;

            if (st.active) {
                slot.innerHTML = "<div style='display:inline-flex;align-items:center;gap:6px;margin-top:6px;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.35);padding:3px 9px;border-radius:7px;'>" +
                    "<span class='worm-loader'><span class='worm-dot'></span><span class='worm-dot'></span><span class='worm-dot'></span></span>" +
                    "<span style='font-size:0.68rem;font-weight:800;color:#22d3ee;'>" + (actLabels[action] || "EJECUTANDO...") + "</span></div>";
                _roleWatchTimers[roleName] = setTimeout(pollOne, 3000);
            } else {
                delete _roleWatchTimers[roleName];
                var ok = !!st.success;
                slot.innerHTML = ok
                    ? "<span style='display:inline-block;margin-top:6px;font-size:0.7rem;font-weight:800;color:#34d399;background:rgba(16,185,129,0.14);border:1px solid rgba(16,185,129,0.35);padding:2px 9px;border-radius:6px;'>✔ SUCCESS</span>"
                    : "<span style='display:inline-block;margin-top:6px;font-size:0.7rem;font-weight:800;color:#fb7185;background:rgba(244,63,94,0.14);border:1px solid rgba(244,63,94,0.35);padding:2px 9px;border-radius:6px;'>✖ FAILED</span>";
                setTimeout(function() {
                    if (typeof loadServiceRoles === "function" && currentService) loadServiceRoles(true);
                }, 2200);
            }
        } catch (e) {
            _roleWatchTimers[roleName] = setTimeout(pollOne, 4000);
        }
    }
    pollOne();
}


/* === BOTON WEB UI POR SERVICIO (ESTILO TAB) === */
var _lastWebUiCheckedKey = "";

async function syncServiceWebUiButton(tabBar) {
    if (!tabBar || !currentCluster || !currentService) return;
    var key = currentCluster + "::" + currentService;
    if (_lastWebUiCheckedKey == key && document.getElementById("srv-webui-tab-btn")) return;
    _lastWebUiCheckedKey = key;

    var oldBtn = document.getElementById("srv-webui-tab-btn");
    if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);

    try {
        var r = await fetch("/api/service-webui?cluster=" + encodeURIComponent(currentCluster) + "&service=" + encodeURIComponent(currentService));
        var d = await r.json();
        if (!d.ok || !d.has_webui || !d.url) return;
        if (_lastWebUiCheckedKey != key || document.getElementById("srv-webui-tab-btn")) return;

        var wBtn = document.createElement("button");
        wBtn.type = "button";
        wBtn.id = "srv-webui-tab-btn";
        wBtn.className = "cm-tab-btn";
        wBtn.title = "Abrir interfaz web nativa: " + d.url;
        wBtn.style.cssText = "border-color:rgba(16,185,129,0.4)!important;color:#34d399!important;";
        wBtn.textContent = "Web UI ↗";
        wBtn.onclick = function() {
            window.open(d.url, "_blank", "noopener,noreferrer");
        };
        tabBar.appendChild(wBtn);

        if (typeof gsap !== "undefined") {
            gsap.fromTo(wBtn, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.22, ease: "back.out(1.6)" });
        }
    } catch (e) {}
}

setInterval(function() {
    var dp = document.getElementById("detail-panel");
    if (!dp || !currentService) { _lastWebUiCheckedKey = ""; return; }
    var tabBar = dp.querySelector(".cm-tabs-bar");
    var mBtn = document.getElementById("srv-metrics-tab-btn");
    if (tabBar && mBtn) {
        syncServiceWebUiButton(tabBar);
    }
}, 400);
