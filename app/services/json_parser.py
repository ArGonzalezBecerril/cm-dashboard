def parse_to_html(obj):
    if isinstance(obj, dict):
        if "items" in obj and isinstance(obj["items"], list):
            return parse_to_html(obj["items"])
        html = '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">'
        for k, v in obj.items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                val_str = str(v).upper()
                color = "text-zinc-100"
                if val_str in ["TRUE", "STARTED", "GOOD", "ACTIVE", "RUNNING"]:
                    color = "text-emerald-400 font-bold"
                elif val_str in ["FALSE", "STOPPED", "BAD", "INACTIVE", "DOWN"]:
                    color = "text-rose-400 font-bold"
                html += f'''
                <div class="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                    <div class="text-xs text-zinc-500 truncate">{k}</div>
                    <div class="text-sm mt-1 font-mono {color} truncate">{v}</div>
                </div>'''
            else:
                html += f'''
                <div class="col-span-full bg-zinc-950/60 p-4 rounded-xl border border-zinc-800">
                    <div class="text-xs font-bold text-cyan-400 mb-3 uppercase tracking-wider">{k}</div>
                    {parse_to_html(v)}
                </div>'''
        html += '</div>'
        return html

    elif isinstance(obj, list):
        if not obj:
            return '<p class="text-sm text-zinc-500">Lista vacía []</p>'
        if all(isinstance(i, dict) for i in obj):
            headers = list(obj[0].keys())[:8]
            html = '<div class="overflow-x-auto"><table class="w-full text-left text-xs border-collapse">'
            html += '<thead><tr class="border-b border-zinc-800 text-zinc-400 uppercase">'
            for h in headers:
                html += f'<th class="py-3 px-3">{h}</th>'
            html += '</tr></thead><tbody class="divide-y divide-zinc-800/60">'
            for row in obj:
                html += '<tr class="hover:bg-zinc-950/50 transition">'
                for h in headers:
                    val = row.get(h, "")
                    val_up = str(val).upper()
                    badge = str(val)
                    if val_up in ["TRUE", "STARTED", "GOOD", "ACTIVE"]:
                        badge = f'<span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">{val}</span>'
                    elif val_up in ["FALSE", "STOPPED", "BAD", "INACTIVE"]:
                        badge = f'<span class="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">{val}</span>'
                    html += f'<td class="py-2.5 px-3">{badge}</td>'
                html += '</tr>'
            html += '</tbody></table></div>'
            return html
        return f'<pre class="text-xs bg-zinc-950 p-4 rounded-xl border border-zinc-800 overflow-x-auto">{obj}</pre>'

    return f'<span class="text-sm font-mono text-cyan-300">{obj}</span>'
