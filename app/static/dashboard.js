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
    btn.title = "Cerrar/Abrir panel estilo macOS";
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

    document.addEventListener("click", function(e) {
        if (!isClosed) return;
        if (e.target.closest(".card-clickable") || e.target.closest("#btn-tls") || e.target.closest("#btn-about")) {
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
