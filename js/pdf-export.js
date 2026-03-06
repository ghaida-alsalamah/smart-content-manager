/* ============================================================
   pdf-export.js — Simple report: charts + AI insights
   ============================================================ */

window.downloadReport = async function () {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded yet — please try again.', 'error');
    return;
  }

  const btn = document.getElementById('downloadPdfBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  try {
    const { jsPDF } = window.jspdf;
    const doc    = new jsPDF({ unit: 'pt', format: 'a4' });
    const PW     = doc.internal.pageSize.getWidth();
    const PH     = doc.internal.pageSize.getHeight();
    const M      = 40;
    const INNER  = PW - M * 2;
    let y        = M;

    const PURPLE = '#8B5CF6';
    const FG     = '#1E293B';
    const MUTED  = '#64748B';
    const GREEN  = '#16A34A';
    const ORANGE = '#D97706';
    const RED    = '#DC2626';

    function clean(str) {
      if (!str) return '';
      return String(str)
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2013\u2014\u2015]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[\u2022\u2023\u2043\u2219\u25CF\u25AA]/g, '*')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function newPage() {
      doc.addPage();
      y = M;
    }

    function space(need) {
      if (y + need > PH - M) newPage();
    }

    /* ── Header ── */
    doc.setFillColor(PURPLE);
    doc.rect(0, 0, PW, 5, 'F');

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(FG);
    doc.text('Smart Content Manager', M, y + 18);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text('Analytics Report  ·  ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), M, y + 34);

    const creatorName = clean((document.getElementById('sidebarName') || {}).textContent || '');
    if (creatorName) {
      doc.text('Creator: ' + creatorName, PW - M, y + 34, { align: 'right' });
    }

    y += 50;
    doc.setDrawColor(PURPLE);
    doc.setLineWidth(0.5);
    doc.line(M, y, PW - M, y);
    y += 18;

    /* ── Charts ── */
    const chartDefs = [
      { key: 'followers',  label: 'Follower Growth' },
      { key: 'engagement', label: 'Engagement Rate' },
      { key: 'posts',      label: 'Post Frequency' },
      { key: 'revenue',    label: 'Revenue' },
    ];

    const available = chartDefs.filter(cd => window.charts && window.charts[cd.key]);

    if (available.length > 0) {
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(FG);
      doc.text('Charts', M, y);
      y += 14;

      const cw = (INNER - 12) / 2;
      const ch = cw * 0.5;

      for (let i = 0; i < available.length; i += 2) {
        space(ch + 24);
        [0, 1].forEach(j => {
          const cd = available[i + j];
          if (!cd) return;
          const img = window.charts[cd.key].toBase64Image('image/png', 1);
          const x   = M + j * (cw + 12);
          doc.setFillColor('#F8FAFC');
          doc.roundedRect(x, y, cw, ch + 16, 3, 3, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(MUTED);
          doc.text(cd.label.toUpperCase(), x + 8, y + 11);
          doc.addImage(img, 'PNG', x + 4, y + 14, cw - 8, ch - 2);
        });
        y += ch + 22;
      }

      y += 6;
      doc.setDrawColor(PURPLE);
      doc.setLineWidth(0.5);
      doc.line(M, y, PW - M, y);
      y += 18;
    }

    /* ── AI Insights — always use English result; Arabic can't render in Helvetica ── */
    const ai = window._aiResultEn || window._aiResult;
    if (ai && Array.isArray(ai.insights) && ai.insights.length > 0) {
      space(30);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(FG);
      doc.text('AI Insights', M, y);
      y += 6;

      if (ai.summary) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(MUTED);
        const lines = doc.splitTextToSize(clean(ai.summary), INNER);
        lines.forEach(l => {
          space(13);
          doc.text(l, M, y);
          y += 13;
        });
      }
      y += 8;

      ai.insights.forEach(ins => {
        space(70);
        const sevColor = ins.severity === 'high' ? RED : ins.severity === 'medium' ? ORANGE : GREEN;
        const sevLabel  = ins.severity === 'high' ? 'HIGH' : ins.severity === 'medium' ? 'MEDIUM' : 'LOW';

        doc.setDrawColor(sevColor);
        doc.setLineWidth(3);
        doc.line(M, y, M, y + 60);

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(FG);
        doc.text(clean(ins.title) || 'Insight', M + 10, y + 12);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(sevColor);
        doc.text(sevLabel, PW - M, y + 12, { align: 'right' });
        y += 20;

        if (ins.explanation) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(MUTED);
          const lines = doc.splitTextToSize(clean(ins.explanation), INNER - 16);
          lines.forEach(l => {
            space(12);
            doc.text(l, M + 10, y);
            y += 12;
          });
        }

        if (ins.action) {
          y += 4;
          space(12);
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(PURPLE);
          doc.text('Recommendation:', M + 10, y);
          y += 12;
          doc.setFont('helvetica', 'normal');
          const recLines = doc.splitTextToSize(clean(ins.action), INNER - 16);
          recLines.forEach(l => {
            space(12);
            doc.text(l, M + 10, y);
            y += 12;
          });
        }

        y += 16;
      });
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
      doc.setDrawColor(PURPLE);
      doc.setLineWidth(3);
      doc.line(0, PH - 5, PW, PH - 5);
    }

    const name = (creatorName || 'report').trim().replace(/\s+/g, '_');
    doc.save('SCM_Report_' + name + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
    showToast('Report downloaded!', 'success');

  } catch (err) {
    console.error('PDF export error:', err);
    showToast('Could not generate PDF: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Download Report'; }
  }
};
