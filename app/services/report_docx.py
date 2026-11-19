import io
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

HEX_DARK = "09090B"
HEX_SLATE = "18181B"
HEX_CYAN = "06B6D4"
HEX_CYAN_DARK = "0E7490"
HEX_ROW_ALT = "F8FAFC"
HEX_CALLOUT_BG = "F1F5F9"
HEX_BORDER = "CBD5E1"

RGB_DARK = RGBColor(0x09, 0x09, 0x0B)
RGB_SLATE = RGBColor(0x18, 0x18, 0x1B)
RGB_CYAN_DARK = RGBColor(0x0E, 0x74, 0x90)
RGB_MUTED = RGBColor(0x64, 0x74, 0x8B)
RGB_WHITE = RGBColor(0xFF, 0xFF, 0xFF)


def _xml(tag_str):
    lt = chr(60)
    gt = chr(62)
    return parse_xml(tag_str.replace("[LT]", lt).replace("[GT]", gt))


def _set_cell_shading(cell, hex_color):
    cell._tc.get_or_add_tcPr().append(_xml(f'[LT]w:shd {nsdecls("w")} w:fill="{hex_color}"/[GT]'))


def _set_cell_margins(cell, top=90, bottom=90, left=130, right=130):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement("w:tcMar")
    for m, val in (("top", top), ("bottom", bottom), ("left", left), ("right", right)):
        node = OxmlElement(f"w:{m}")
        node.set(qn("w:w"), str(val))
        node.set(qn("w:type"), "dxa")
        tcMar.append(node)
    tcPr.append(tcMar)


def _set_table_borders(table, border_color=HEX_BORDER):
    tblPr = table._tbl.tblPr
    tblPr.append(_xml(
        f'[LT]w:tblBorders {nsdecls("w")}[GT]'
        f'[LT]w:top w:val="single" w:sz="6" w:space="0" w:color="{border_color}"/[GT]'
        f'[LT]w:bottom w:val="single" w:sz="8" w:space="0" w:color="{HEX_CYAN}"/[GT]'
        f'[LT]w:insideH w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/[GT]'
        f'[LT]w:left w:val="none"/[GT][LT]w:right w:val="none"/[GT][LT]w:insideV w:val="none"/[GT]'
        f'[LT]/w:tblBorders[GT]'
    ))


def _add_section_heading(doc, num_str, title_str):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True

    r_num = p.add_run(f"{num_str}  ")
    r_num.bold = True
    r_num.font.size = Pt(13)
    r_num.font.color.rgb = RGB_CYAN_DARK

    r_tit = p.add_run(title_str.upper())
    r_tit.bold = True
    r_tit.font.size = Pt(12)
    r_tit.font.color.rgb = RGB_DARK

    p._p.get_or_add_pPr().append(_xml(
        f'[LT]w:pBdr {nsdecls("w")}[GT][LT]w:bottom w:val="single" w:sz="12" w:space="4" w:color="{HEX_CYAN}"/[GT][LT]/w:pBdr[GT]'
    ))


def _add_callout_box(doc, title, bullets):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = tbl.cell(0, 0)
    cell.width = Inches(6.8)
    _set_cell_shading(cell, HEX_CALLOUT_BG)
    _set_cell_margins(cell, top=110, bottom=110, left=170, right=150)
    cell._tc.get_or_add_tcPr().append(_xml(
        f'[LT]w:tcBorders {nsdecls("w")}[GT]'
        f'[LT]w:left w:val="single" w:sz="24" w:space="0" w:color="{HEX_CYAN}"/[GT]'
        f'[LT]w:top w:val="none"/[GT][LT]w:right w:val="none"/[GT][LT]w:bottom w:val="none"/[GT]'
        f'[LT]/w:tcBorders[GT]'
    ))
    p0 = cell.paragraphs.pop(0)
    p0.paragraph_format.space_after = Pt(4)
    rt = p0.add_run(title)
    rt.bold = True
    rt.font.size = Pt(10)
    rt.font.color.rgb = RGB_CYAN_DARK
    for b in bullets:
        pb = cell.add_paragraph()
        pb.paragraph_format.space_after = Pt(2)
        pb.paragraph_format.left_indent = Inches(0.15)
        rb = pb.add_run(f"▸  {b}")
        rb.font.size = Pt(9.5)
        rb.font.color.rgb = RGB_SLATE


def _add_styled_table(doc, headers, rows, right_align_cols=None):
    right_align_cols = right_align_cols or set()
    tbl = doc.add_table(rows=len(rows) + 1, cols=len(headers))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    _set_table_borders(tbl)

    hdr_cells = tbl.rows.pop(0).cells if False else tbl.rows[0].cells
    for idx, text in enumerate(headers):
        c = hdr_cells[idx]
        c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        _set_cell_shading(c, HEX_SLATE)
        _set_cell_margins(c, top=85, bottom=85, left=100, right=100)
        p = c.paragraphs.pop(0)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT if idx in right_align_cols else WD_ALIGN_PARAGRAPH.LEFT
        r = p.add_run(text)
        r.bold = True
        r.font.size = Pt(8.5)
        r.font.color.rgb = RGB_WHITE

    for r_idx, row_vals in enumerate(rows):
        row_cells = tbl.rows[r_idx + 1].cells
        bg = HEX_ROW_ALT if r_idx % 2 == 1 else "FFFFFF"
        for c_idx, val in enumerate(row_vals):
            c = row_cells[c_idx]
            c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            _set_cell_shading(c, bg)
            _set_cell_margins(c, top=65, bottom=65, left=100, right=100)
            p = c.paragraphs.pop(0)
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT if c_idx in right_align_cols else WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(str(val))
            r.font.size = Pt(8.5)
            if c_idx == 0:
                r.bold = True
                r.font.color.rgb = RGB_DARK
            else:
                r.font.color.rgb = RGB_SLATE


def build_usage_report_docx(data):
    doc = Document()
    for sec in doc.sections:
        sec.top_margin = Inches(0.7)
        sec.bottom_margin = Inches(0.7)
        sec.left_margin = Inches(0.8)
        sec.right_margin = Inches(0.8)

    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(10)

    cluster = data.get("cluster", "Quintana Roo")
    period = data.get("period", "")
    gen_at = data.get("generated_at", "")
    days = data.get("days", 7)
    kpis = data.get("kpis") or {}

    p_tag = doc.add_paragraph()
    p_tag.paragraph_format.space_after = Pt(2)
    r_tag = p_tag.add_run("CLOUDERA API MONITOR  |  REPORTE EJECUTIVO DE TELEMETRÍA")
    r_tag.bold = True
    r_tag.font.size = Pt(9)
    r_tag.font.color.rgb = RGB_CYAN_DARK

    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_after = Pt(2)
    r_title = p_title.add_run("Reporte General de Uso del Clúster Hadoop")
    r_title.bold = True
    r_title.font.size = Pt(20)
    r_title.font.color.rgb = RGB_DARK

    p_sub = doc.add_paragraph()
    p_sub.paragraph_format.space_after = Pt(10)
    r_sub = p_sub.add_run(f"Estadísticas Consolidadas de Almacenamiento HDFS, Impala, YARN y HBase — Clúster {cluster}")
    r_sub.font.size = Pt(10.5)
    r_sub.font.color.rgb = RGB_MUTED

    meta_rows = (
        ("Entorno del Clúster", f"Clúster Hadoop On-Premise — {cluster}"),
        ("Periodo de Análisis", f"{period} (Últimos {days} días)"),
        ("Fecha de Emisión", gen_at),
        ("Clasificación", "Uso Interno / Operación Big Data"),
        ("Fuente de Datos", "Cloudera Manager REST API / Timeseries"),
    )
    meta_tbl = doc.add_table(rows=len(meta_rows), cols=2)
    meta_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    _set_table_borders(meta_tbl)
    for idx, (k_lbl, v_lbl) in enumerate(meta_rows):
        c0 = meta_tbl.rows[idx].cells[0]
        c1 = meta_tbl.rows[idx].cells[1]
        c0.width = Inches(2.2)
        c1.width = Inches(4.6)
        _set_cell_shading(c0, HEX_CALLOUT_BG)
        _set_cell_shading(c1, "FFFFFF")
        _set_cell_margins(c0, top=60, bottom=60, left=120, right=100)
        _set_cell_margins(c1, top=60, bottom=60, left=120, right=100)
        r0 = c0.paragraphs.pop(0).add_run(k_lbl)
        r0.bold = True
        r0.font.size = Pt(9)
        r0.font.color.rgb = RGB_DARK
        r1 = c1.paragraphs.pop(0).add_run(v_lbl)
        r1.font.size = Pt(9)
        r1.font.color.rgb = RGB_SLATE

    _add_section_heading(doc, "1.", "Resumen de Métricas Clave y Hallazgos")
    kpi_cards = (
        ("TOTAL DISCO HDFS (LÓGICO)", f"{kpis.get('total_logical_gb', 0)} GB", "Bytes lógicos sin replicación"),
        ("TOTAL DISCO RAW (~3X)", f"{kpis.get('total_raw_gb', 0)} GB", "Incluye factor de replicación HDFS"),
        ("PRINCIPAL CONSUMIDOR", f"{kpis.get('top1_user', 'N/A')}", f"{kpis.get('top1_gb', 0)} GB ({kpis.get('top1_pct', 0)}% del total)"),
        ("SEGUNDO CONSUMIDOR", f"{kpis.get('top2_user', 'N/A')}", f"{kpis.get('top2_gb', 0)} GB ({kpis.get('top2_pct', 0)}% del total)"),
        ("APLICACIONES YARN", f"{kpis.get('yarn_apps', 0)}", f"Ejecuciones en los últimos {days} días"),
        ("CONSULTAS IMPALA", f"{kpis.get('impala_queries', 0)}", f"Queries procesadas en {days} días"),
    )

    kpi_tbl = doc.add_table(rows=2, cols=3)
    kpi_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    for idx, (k_t, k_v, k_s) in enumerate(kpi_cards):
        cell = kpi_tbl.rows[idx // 3].cells[idx % 3]
        cell.width = Inches(2.25)
        _set_cell_shading(cell, HEX_ROW_ALT)
        _set_cell_margins(cell, top=85, bottom=85, left=110, right=110)
        cell._tc.get_or_add_tcPr().append(_xml(
            f'[LT]w:tcBorders {nsdecls("w")}[GT]'
            f'[LT]w:top w:val="single" w:sz="12" w:space="0" w:color="{HEX_CYAN}"/[GT]'
            f'[LT]w:left w:val="single" w:sz="4" w:space="0" w:color="{HEX_BORDER}"/[GT]'
            f'[LT]w:right w:val="single" w:sz="4" w:space="0" w:color="{HEX_BORDER}"/[GT]'
            f'[LT]w:bottom w:val="single" w:sz="4" w:space="0" w:color="{HEX_BORDER}"/[GT]'
            f'[LT]/w:tcBorders[GT]'
        ))
        p = cell.paragraphs.pop(0)
        p.paragraph_format.space_after = Pt(2)
        rt = p.add_run(k_t)
        rt.bold = True
        rt.font.size = Pt(7.5)
        rt.font.color.rgb = RGB_MUTED
        pv = cell.add_paragraph()
        pv.paragraph_format.space_after = Pt(1)
        rv = pv.add_run(k_v)
        rv.bold = True
        rv.font.size = Pt(13)
        rv.font.color.rgb = RGB_DARK
        ps = cell.add_paragraph()
        ps.paragraph_format.space_after = Pt(0)
        rs = ps.add_run(k_s)
        rs.font.size = Pt(7.5)
        rs.font.color.rgb = RGB_CYAN_DARK

    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    _add_callout_box(doc, "HALLAZGOS PRINCIPALES DEL PERIODO", data.get("findings") or ("Sin hallazgos registrados.",))

    _add_section_heading(doc, "2.", "Uso Actual de Disco HDFS por Usuario / Directorio")
    u_rows = [(u["user"], f"{u['bytes_logical']:,}", f"{u['gb_logical']} GB", f"{u['gb_raw']} GB", f"{u['files']:,}", f"{u['pct']}%") for u in (data.get("hdfs_users") or list())] or [("Sin datos HDFS", "0", "0 GB", "0 GB", "0", "0%")]
    _add_styled_table(doc, ("Usuario / Dir", "Bytes Lógicos", "GB Lógicos", "GB Raw (~3x)", "Archivos/Dirs", "% del Total"), u_rows, right_align_cols={1, 2, 3, 4, 5})

    _add_section_heading(doc, "3.", "Actividad de Consultas Impala")
    imp_rows = [(r["date"], f"{r['queries']:,}", f"{r['duration']:,} ms") for r in (data.get("impala") or list())] or [("Sin actividad registrada en el periodo", "0", "0 ms")]
    _add_styled_table(doc, ("Fecha", "Queries / Día", "Duración Acumulada"), imp_rows, right_align_cols={1, 2})

    _add_section_heading(doc, "4.", "Actividad YARN (Aplicaciones)")
    y_rows = [(r["date"], f"{r['apps']:,}", f"{r['duration']:,} s") for r in (data.get("yarn") or list())] or [("Sin aplicaciones YARN en el periodo", "0", "0 s")]
    _add_styled_table(doc, ("Fecha", "Apps Ingeridas", "Duración / Recursos"), y_rows, right_align_cols={1, 2})

    _add_section_heading(doc, "5.", "Tablas HBase y Glosario Técnico")
    hb_rows = [(t["table"], t["namespace"], f"{t['bytes']:,}", f"{t['mb']} MB", f"{t['gets_day']:,}") for t in (data.get("hbase_tables") or list())[:20]] or [("Sin tablas HBase registradas", "-", "0", "0 MB", "0")]
    _add_styled_table(doc, ("Tabla HBase", "Namespace", "Tamaño (Bytes)", "Tamaño (MB)", "Gets / Día (aprox)"), hb_rows, right_align_cols={2, 3, 4})

    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    _add_callout_box(doc, "GLOSARIO DE MÉTRICAS Y NOTAS METODOLÓGICAS", (
        "Bytes Lógicos: Tamaño real de los datos almacenados sin considerar la replicación de HDFS.",
        "Bytes Raw (~3x): Espacio físico ocupado en disco incluyendo el factor de replicación de bloques HDFS.",
        "DesiredRollup DAILY: Agregación diaria entregada por el motor Timeseries de Cloudera Manager.",
    ))

    p_foot = doc.add_paragraph()
    p_foot.paragraph_format.space_before = Pt(14)
    rf = p_foot.add_run(f"Documento generado automáticamente por Cloudera API Monitor  |  Clúster {cluster}  |  {gen_at}")
    rf.font.size = Pt(8)
    rf.font.color.rgb = RGB_MUTED

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
