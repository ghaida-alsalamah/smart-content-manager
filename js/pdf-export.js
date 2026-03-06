/* ============================================================
   pdf-export.js — Charts + Insights captured as images (html2canvas)
   Avoids all jsPDF font/encoding issues with non-ASCII text.
   ============================================================ */

window.downloadReport = async function () {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded yet — please try again.', 'error');
    return;
  }
  if (typeof html2canvas === 'undefined') {
    showToast('Screenshot library not loaded yet — please try again.', 'error');
    return;
  }

  const btn = document.getElementById('downloadPdfBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  try {
    const { jsPDF } = window.jspdf;
    const doc   = new jsPDF({ unit: 'pt', format: 'a4' });
    const PW    = doc.internal.pageSize.getWidth();
    const PH    = doc.internal.pageSize.getHeight();
    const M     = 40;
    const INNER = PW - M * 2;
    let y       = M;

    const PURPLE = '#8B5CF6';
    const FG     = '#1E293B';
    const MUTED  = '#64748B';

    function newPage() { doc.addPage(); y = M; }
    function space(need) { if (y + need > PH - M) newPage(); }

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
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    doc.text('Analytics Report  -  ' + dateStr, M, y + 34);

    const rawName = (document.getElementById('sidebarName') || {}).textContent || '';
    const safeName = rawName.replace(/[^\x20-\x7E]/g, '').trim();
    if (safeName) doc.text('Creator: ' + safeName, PW - M, y + 34, { align: 'right' });

    y += 52;
    doc.setDrawColor(PURPLE);
    doc.setLineWidth(0.5);
    doc.line(M, y, PW - M, y);
    y += 20;

    /* ── Charts ── */
    const chartDefs = [
      { key: 'followers',  label: 'FOLLOWER GROWTH' },
      { key: 'engagement', label: 'ENGAGEMENT RATE' },
      { key: 'posts',      label: 'POST FREQUENCY' },
      { key: 'revenue',    label: 'REVENUE' },
    ];
    const available = chartDefs.filter(cd => window.charts && window.charts[cd.key]);

    if (available.length > 0) {
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(FG);
      doc.text('Charts', M, y);
      y += 16;

      const cw = (INNER - 12) / 2;
      const ch = Math.round(cw * 0.5);

      for (let i = 0; i < available.length; i += 2) {
        space(ch + 28);
        [0, 1].forEach(j => {
          const cd = available[i + j];
          if (!cd) return;
          const x   = M + j * (cw + 12);
          const img = window.charts[cd.key].toBase64Image('image/png', 1);
          doc.setFillColor('#F8FAFC');
          doc.roundedRect(x, y, cw, ch + 18, 3, 3, 'F');
          doc.setFontSize(7);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(MUTED);
          doc.text(cd.label, x + 8, y + 12);
          doc.addImage(img, 'PNG', x + 4, y + 16, cw - 8, ch);
        });
        y += ch + 26;
      }

      y += 6;
      doc.setDrawColor(PURPLE);
      doc.setLineWidth(0.5);
      doc.line(M, y, PW - M, y);
      y += 20;
    }

    /* ── AI Insights — captured as image from the DOM ── */
    const insightsGrid = document.getElementById('insightsGrid');
    if (insightsGrid && insightsGrid.children.length > 0) {
      space(30);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(FG);
      doc.text('AI Insights', M, y);
      y += 14;

      const canvas = await html2canvas(insightsGrid, {
        scale: 2,
        useCORS: true,
        backgroundColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#0D1117' : '#FFFFFF',
        logging: false,
      });

      const imgData  = canvas.toDataURL('image/png');
      const srcW     = canvas.width;
      const srcH     = canvas.height;
      const destW    = INNER;
      const destH    = Math.round((srcH / srcW) * destW);
      const pageH    = PH - M - y;

      if (destH <= pageH) {
        doc.addImage(imgData, 'PNG', M, y, destW, destH);
        y += destH + 10;
      } else {
        const sliceH    = Math.floor(srcH * (pageH / destH));
        let   sliceTop  = 0;
        let   remaining = srcH;

        while (remaining > 0) {
          const chunk    = Math.min(sliceH, remaining);
          const chunkDoc = Math.round((chunk / srcW) * destW);

          const slice    = document.createElement('canvas');
          slice.width    = srcW;
          slice.height   = chunk;
          slice.getContext('2d').drawImage(canvas, 0, sliceTop, srcW, chunk, 0, 0, srcW, chunk);

          doc.addImage(slice.toDataURL('image/png'), 'PNG', M, y, destW, chunkDoc);
          sliceTop  += chunk;
          remaining -= chunk;

          if (remaining > 0) {
            newPage();
          } else {
            y += chunkDoc + 10;
          }
        }
      }
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

    const fn = 'SCM_Report_' + (safeName || 'report').replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
    doc.save(fn);
    showToast('Report downloaded!', 'success');

  } catch (err) {
    console.error('PDF export error:', err);
    showToast('Could not generate PDF: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Download Report'; }
  }
};
