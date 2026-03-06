/* ============================================================
   pdf-export.js — Charts only, supports AR/EN, light/dark
   ============================================================ */

window.downloadReport = async function () {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded yet — please try again.', 'error');
    return;
  }

  const btn = document.getElementById('downloadPdfBtn');
  if (btn) { btn.disabled = true; btn.textContent = i18n.t('pdf.generating') || 'Generating...'; }

  try {
    /* ── Ensure charts are rendered even if user hasn't visited Charts section ── */
    const hasCharts = window.charts && Object.values(window.charts).some(c => c);
    if (!hasCharts && typeof getFilteredData === 'function' && typeof renderCharts === 'function') {
      const data = getFilteredData();
      const kpis = computeKPIs(data);
      if (data.length > 0) {
        const sec  = document.getElementById('section-charts');
        const cont = document.getElementById('chartsContent');
        const empt = document.getElementById('chartsEmpty');
        const wasHidden = sec && sec.classList.contains('hidden');
        if (sec)  sec.classList.remove('hidden');
        if (cont) cont.classList.remove('hidden');
        if (empt) empt.classList.add('hidden');
        renderCharts(data, kpis);
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 150)));
        if (wasHidden && sec) sec.classList.add('hidden');
      }
    }

    const { jsPDF } = window.jspdf;
    const isRTL  = document.documentElement.getAttribute('dir') === 'rtl' || i18n.current === 'ar';
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    const BG     = isDark ? '#0D1117' : '#FFFFFF';
    const FG     = isDark ? '#EEF2FF' : '#1E293B';
    const MUTED  = isDark ? '#8899BB' : '#64748B';
    const PURPLE = '#8B5CF6';

    const doc   = new jsPDF({ unit: 'pt', format: 'a4' });
    const PW    = doc.internal.pageSize.getWidth();
    const PH    = doc.internal.pageSize.getHeight();
    const M     = 40;
    const INNER = PW - M * 2;
    let y       = M;

    function newPage() {
      doc.addPage();
      doc.setFillColor(BG);
      doc.rect(0, 0, PW, PH, 'F');
      y = M;
    }
    function space(need) { if (y + need > PH - M) newPage(); }

    /* ── Background ── */
    doc.setFillColor(BG);
    doc.rect(0, 0, PW, PH, 'F');

    /* ── Top accent bar ── */
    doc.setFillColor(PURPLE);
    doc.rect(0, 0, PW, 5, 'F');

    /* ── Header ── */
    const title    = isRTL ? 'Smart Content Manager' : 'Smart Content Manager';
    const subtitle = isRTL ? 'Analytics Report' : 'Analytics Report';
    const dateStr  = new Date().toLocaleDateString(isRTL ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(FG);
    doc.text(title, M, y + 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text(subtitle + '  -  ' + dateStr.replace(/[^\x20-\x7E]/g, '').trim(), M, y + 36);

    y += 52;
    doc.setDrawColor(PURPLE);
    doc.setLineWidth(0.5);
    doc.line(M, y, PW - M, y);
    y += 20;

    /* ── Charts ── */
    const chartDefs = [
      { key: 'followers',  labelEn: 'Follower Growth',  labelAr: 'Follower Growth' },
      { key: 'engagement', labelEn: 'Engagement Rate',  labelAr: 'Engagement Rate' },
      { key: 'posts',      labelEn: 'Post Frequency',   labelAr: 'Post Frequency' },
      { key: 'revenue',    labelEn: 'Revenue',          labelAr: 'Revenue' },
    ];

    const available = chartDefs.filter(cd => window.charts && window.charts[cd.key]);

    const cw = (INNER - 12) / 2;
    const ch = Math.round(cw * 0.52);

    for (let i = 0; i < available.length; i += 2) {
      space(ch + 32);
      [0, 1].forEach(j => {
        const cd = available[i + j];
        if (!cd) return;
        const x   = M + j * (cw + 12);
        const img = window.charts[cd.key].toBase64Image('image/png', 1);

        doc.setFillColor(isDark ? '#161B27' : '#F8FAFC');
        doc.roundedRect(x, y, cw, ch + 20, 4, 4, 'F');

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(MUTED);
        doc.text((isRTL ? cd.labelAr : cd.labelEn).toUpperCase(), x + 8, y + 13);

        doc.addImage(img, 'PNG', x + 4, y + 18, cw - 8, ch - 2);
      });
      y += ch + 28;
    }

    /* ── Footer on every page ── */
    const total = doc.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(MUTED);
      doc.text('Smart Content Manager', M, PH - 18);
      doc.text('Page ' + p + ' of ' + total, PW - M, PH - 18, { align: 'right' });
      doc.setFillColor(PURPLE);
      doc.rect(0, PH - 5, PW, 5, 'F');
    }

    const rawName = (document.getElementById('sidebarName') || {}).textContent || 'report';
    const safeName = rawName.replace(/[^\x20-\x7E]/g, '').trim() || 'report';
    doc.save('SCM_Report_' + safeName.replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
    showToast(i18n.t('toast.report.downloaded') || 'Report downloaded!', 'success');

  } catch (err) {
    console.error('PDF export error:', err);
    showToast('Could not generate PDF: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Download Report'; }
  }
};
