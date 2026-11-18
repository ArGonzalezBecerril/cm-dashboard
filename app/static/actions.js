var cmdPollTimeout = null, cmdAttemptCount = 0;

function stopCommandPoll() { if (cmdPollTimeout) { clearTimeout(cmdPollTimeout); cmdPollTimeout = null; } }
function toggleActionMenu(ev) { ev.stopPropagation(); var m = document.getElementById("cm-action-dropdown"); if (m) m.classList.toggle("open"); }
document.addEventListener("click", function() { var m = document.getElementById("cm-action-dropdown"); if (m) m.classList.remove("open"); });

function renderInlineExecBox(cmdId, text, isDone, isError) {
    var box = document.getElementById("inline-exec-" + cmdId) || document.getElementById("service-exec-container");
    if (!box) return;
    var borderCol = isError ? "rgba(244,63,94,0.5)" : (isDone ? "rgba(16,185,129,0.5)" : "rgba(34,211,238,0.38)");
    var titleCol = isError ? "#fb7185" : (isDone ? "#34d399" : "#22d3ee");
    var headerTxt = isError ? "OPERACIÓN FALLIDA" : (isDone ? "OPERACIÓN COMPLETADA" : "EJECUTANDO EN CLOUDERA");
    var wormHtml = !isDone
        ? '<span class="worm-loader"><span class="worm-dot"></span><span class="worm-dot"></span><span class="worm-dot"></span></span>'
        : '<span style="color:' + titleCol + ';font-weight:700;font-size:0.9rem;">' + (isError ? '✖' : '✔') + '</span>';

    box.innerHTML = '<div id="toast-cmd-' + cmdId + '" class="cm-exec-box" style="border-color:' + borderCol + ';margin-top:0.65rem;margin-bottom:0;transition:opacity 0.5s ease;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">' +
            '<strong style="color:' + titleCol + ';font-size:0.74rem;letter-spacing:0.5px;">' + headerTxt + '</strong>' + wormHtml +
        '</div>' +
        '<div class="cm-console-log" style="margin-top:0;font-size:0.75rem;color:#e4e4e7;">> ' + text + '</div>' +
    '</div>';

    if (isDone) {
        setTimeout(function() {
            var t = document.getElementById("toast-cmd-" + cmdId);
            if (t) t.style.opacity = "0";
            setTimeout(function() { if (box) box.innerHTML = ""; loadServiceHistory(true); }, 500);
        }, 2500);
    }
}

async function triggerServiceAction(action) {
    var m = document.getElementById("cm-action-dropdown"); if (m) m.classList.remove("open");
    if (!currentCluster || !currentService) return;
    var labels = { start: "Iniciando", stop: "Deteniendo", restart: "Reiniciando" };
    var lbl = labels[action] || action;
    if (!confirm("¿Confirmas " + lbl.toLowerCase() + " " + currentDisplayName + "?")) return;

    stopCommandPoll(); cmdAttemptCount = 0;
    switchServiceTab("history");
    try {
        var res = await fetch("/api/service-command", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cluster: currentCluster, service: currentService, display_name: currentDisplayName, action: action })
        });
        var data = await res.json();
        if (!data.ok) { alert("Error: " + data.error); return; }
        await loadServiceHistory(false);
        pollCommandProgress(data.commandId, lbl);
    } catch (e) {}
}

function pollCommandProgress(cmdId, labelTxt) {
    stopCommandPoll();
    async function checkOnce() {
        cmdAttemptCount++;
        var nextDelay = cmdAttemptCount <= 6 ? 3000 : 10000;
        try {
            var res = await fetch("/api/command-status/" + cmdId);
            var st = await res.json();
            if (!st.ok) return;
            var activeStep = (st.children || []).find(function(c) { return c.active; });
            var stepText = activeStep ? activeStep.name : (labelTxt + " " + currentDisplayName);
            if (st.active) {
                renderInlineExecBox(cmdId, stepText + "...", false, false);
                cmdPollTimeout = setTimeout(checkOnce, nextDelay);
            } else {
                stopCommandPoll();
                var ok = !!st.success;
                renderInlineExecBox(cmdId, ok ? "Terminado" : "Error al ejecutar", true, !ok);
                loadServiceRoles(true);
                if (typeof fetchLiveAgent === "function") fetchLiveAgent("services");
            }
        } catch (e) { cmdPollTimeout = setTimeout(checkOnce, nextDelay); }
    }
    checkOnce();
}

async function loadServiceHistory(skipAutoResume) {
    var histBox = document.getElementById("service-history-box");
    if (!histBox || !currentCluster || !currentService) return;
    try {
        var res = await fetch("/api/service-history?cluster=" + encodeURIComponent(currentCluster) + "&service=" + encodeURIComponent(currentService));
        var data = await res.json();
        if (!data.ok || !data.history || data.history.length === 0) {
            histBox.innerHTML = '<div style="font-size:0.72rem;color:#71717a;">Sin acciones registradas para este servicio.</div>';
            return;
        }
        histBox.innerHTML = data.history.map(function(h) {
            var isRun = h.status === "RUNNING";
            var badge = isRun
                ? '<div style="display:inline-flex;align-items:center;gap:6px;"><span class="worm-loader"><span class="worm-dot"></span><span class="worm-dot"></span><span class="worm-dot"></span></span><span style="color:#10b981;font-size:0.7rem;font-weight:700;">RUNNING</span></div>'
                : (h.status === "SUCCESS" ? '<span class="txt-green">SUCCESS</span>' : '<span class="txt-red">' + h.status + '</span>');
            var inlineSlot = isRun ? '<div id="inline-exec-' + h.command_id + '"></div>' : '';
            return '<div class="chk-row" style="flex-direction:column;align-items:stretch;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                    '<div><strong style="color:#e4e4e7;text-transform:uppercase;">' + h.action + '</strong> <span style="color:#71717a;">por ' + h.executed_by + ' (#' + h.command_id + ')</span><div style="font-size:0.68rem;color:#71717a;">' + h.executed_at + '</div></div>' +
                    badge +
                '</div>' + inlineSlot + '</div>';
        }).join("");

        var runningItem = data.history.find(function(x) { return x.status === "RUNNING" && x.command_id; });
        if (runningItem && !skipAutoResume) {
            var labels = { start: "Iniciando", stop: "Deteniendo", restart: "Reiniciando" };
            pollCommandProgress(runningItem.command_id, labels[runningItem.action] || runningItem.action);
        }
    } catch (e) {}
}

function switchServiceTab(tabName) {
    var bR = document.getElementById("tab-btn-roles"), bH = document.getElementById("tab-btn-history");
    var pR = document.getElementById("tab-pane-roles"), pH = document.getElementById("tab-pane-history");
    if (!bR || !bH || !pR || !pH) return;
    var isHist = tabName === "history";
    bR.classList.toggle("active", !isHist); bH.classList.toggle("active", isHist);
    pR.classList.toggle("active", !isHist); pH.classList.toggle("active", isHist);
    if (isHist) loadServiceHistory(false);
}
