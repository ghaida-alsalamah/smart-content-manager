/* ============================================================
   pdf-export.js — Download creator analytics report as PDF
   Uses jsPDF (text/layout) + Chart.js toBase64Image() for charts
   ============================================================ */

window.downloadReport = async function () {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded yet — please try again in a moment.', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;

  const btn = document.getElementById('downloadPdfBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  try {
    const doc    = new jsPDF({ unit: 'pt', format: 'a4' });
    const PW     = doc.internal.pageSize.getWidth();
    const PH     = doc.internal.pageSize.getHeight();
    const MARGIN = 40;
    const INNER  = PW - MARGIN * 2;
    let y        = MARGIN;

    const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
    const BG      = isDark ? '#0D1117' : '#FFFFFF';
    const FG      = isDark ? '#EEF2FF' : '#1E293B';
    const MUTED   = isDark ? '#8899BB' : '#64748B';
    const ACCENT  = '#8B5CF6';
    const GREEN   = '#34D399';
    const RED     = '#F87171';

    function setFont(size, style, color) {
      doc.setFontSize(size);
      doc.setFont('helvetica', style || 'normal');
      doc.setTextColor(color || FG);
    }

    function addPage() {
      doc.addPage();
      y = MARGIN;
      doc.setFillColor(BG);
      doc.rect(0, 0, PW, PH, 'F');
    }

    function checkSpace(needed) {
      if (y + needed > PH - MARGIN) addPage();
    }

    function hRule(color, thickness) {
      doc.setDrawColor(color || ACCENT);
      doc.setLineWidth(thickness || 0.5);
      doc.line(MARGIN, y, PW - MARGIN, y);
      y += 12;
    }

    function textLine(text, size, style, color, indent) {
      setFont(size || 11, style || 'normal', color);
      const x = MARGIN + (indent || 0);
      doc.text(String(text), x, y);
      y += (size || 11) * 1.5;
    }

    function wrappedText(text, size, color, indent) {
      setFont(size || 10, 'normal', color || MUTED);
      const x     = MARGIN + (indent || 0);
      const lines = doc.splitTextToSize(String(text), INNER - (indent || 0));
      lines.forEach(line => {
        checkSpace(14);
        doc.text(line, x, y);
        y += (size || 10) * 1.5;
      });
    }

    function kpiBox(label, value, x, bw, color) {
      doc.setFillColor(isDark ? '#1A2035' : '#F1F5F9');
      doc.roundedRect(x, y, bw, 48, 4, 4, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(MUTED);
      doc.text(String(label).toUpperCase(), x + 8, y + 14);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(color || FG);
      doc.text(String(value), x + 8, y + 36);
    }

    function readEl(id) {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : '—';
    }

    /* ── Page background ── */
    doc.setFillColor(BG);
    doc.rect(0, 0, PW, PH, 'F');

    /* ── HEADER ── */
    doc.setFillColor(ACCENT);
    doc.rect(0, 0, PW, 6, 'F');
    y = 30;

    setFont(22, 'bold', FG);
    doc.text('Smart Content Manager', MARGIN, y);
    y += 18;
    setFont(11, 'normal', MUTED);
    doc.text('Creator Analytics Report', MARGIN, y);

    const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    doc.text(now, PW - MARGIN, y, { align: 'right' });
    y += 6;

    const creatorName = readEl('dashUserName') || readEl('sidebarName');
    const platform    = readEl('platformBadge');
    if (creatorName && creatorName !== '—') {
      setFont(10, 'normal', MUTED);
      doc.text(`Creator: ${creatorName}  ·  Platform: ${platform}`, MARGIN, y + 12);
      y += 20;
    }

    y += 8;
    hRule(ACCENT, 1);

    /* ── KPI SUMMARY ── */
    textLine('Key Performance Indicators', 14, 'bold', FG);
    y += 4;

    const kpis = [
      { label: 'Engagement Rate', id: 'kpiEngRate' },
      { label: 'Follower Growth', id: 'kpiGrowth' },
      { label: 'Revenue Volatility', id: 'kpiVolatility' },
      { label: 'Total Followers', id: 'kpiFollowers' },
      { label: 'Total Posts', id: 'kpiPosts' },
      { label: 'Revenue', id: 'kpiRevenue' },
    ];

    const boxW   = (INNER - 10 * 2) / 3;
    const startX = MARGIN;

    for (let i = 0; i < kpis.length; i += 3) {
      checkSpace(60);
      [0, 1, 2].forEach(j => {
        const k = kpis[i + j];
        if (!k) return;
        kpiBox(k.label, readEl(k.id), startX + j * (boxW + 10), boxW, ACCENT);
      });
      y += 58;
    }

    /* ── HEALTH SCORE ── */
    const healthVal = readEl('healthScoreValue');
    const healthSts = readEl('healthScoreStatus');
    if (healthVal && healthVal !== '—') {
      checkSpace(44);
      doc.setFillColor(isDark ? '#1A2035' : '#F1F5F9');
      doc.roundedRect(MARGIN, y, INNER, 38, 4, 4, 'F');
      setFont(10, 'bold', MUTED);
      doc.text('CREATOR BUSINESS HEALTH SCORE', MARGIN + 12, y + 14);
      setFont(16, 'bold', GREEN);
      doc.text(`${healthVal}  ·  ${healthSts}`, MARGIN + 12, y + 32);
      y += 50;
    }

    y += 4;
    hRule(ACCENT, 0.5);

    /* ── CHARTS ── */
    const chartDefs = [
      { key: 'followers',  label: 'Follower Growth' },
      { key: 'posts',      label: 'Post Frequency' },
      { key: 'engagement', label: 'Engagement Rate' },
      { key: 'revenue',    label: 'Revenue' },
    ];

    const validCharts = chartDefs.filter(cd => window.charts && window.charts[cd.key]);

    if (validCharts.length > 0) {
      textLine('Analytics Charts', 14, 'bold', FG);
      y += 4;

      const chartW = (INNER - 12) / 2;
      const chartH = chartW * 0.55;

      for (let i = 0; i < validCharts.length; i += 2) {
        checkSpace(chartH + 30);
        [0, 1].forEach(j => {
          const cd = validCharts[i + j];
          if (!cd) return;
          const imgData = window.charts[cd.key].toBase64Image('image/png', 1);
          const x = MARGIN + j * (chartW + 12);
          doc.setFillColor(isDark ? '#1A2035' : '#F8FAFC');
          doc.roundedRect(x, y, chartW, chartH + 20, 4, 4, 'F');
          setFont(9, 'bold', FG);
          doc.text(cd.label, x + 8, y + 13);
          doc.addImage(imgData, 'PNG', x + 4, y + 18, chartW - 8, chartH - 4);
        });
        y += chartH + 28;
      }
      y += 4;
      hRule(ACCENT, 0.5);
    }

    /* ── AI INSIGHTS ── */
    const aiResult = window._aiResult;
    if (aiResult && Array.isArray(aiResult.insights) && aiResult.insights.length > 0) {
      checkSpace(40);
      textLine('AI-Generated Insights', 14, 'bold', FG);
      if (aiResult.summary) {
        wrappedText(aiResult.summary, 10, MUTED);
        y += 4;
      }

      aiResult.insights.forEach(ins => {
        checkSpace(60);
        const sevColor = ins.severity === 'high' ? RED : ins.severity === 'medium' ? '#FBBF24' : GREEN;
        const icon     = ins.severity === 'high' ? '⚠' : ins.severity === 'medium' ? '◆' : '✓';

        doc.setFillColor(isDark ? '#1A2035' : '#F8FAFC');
        doc.setDrawColor(sevColor);
        doc.setLineWidth(2);
        doc.roundedRect(MARGIN, y, INNER, 4, 0, 0, 'F');

        const titleStart = y + 4;
        setFont(11, 'bold', FG);
        doc.text(`${icon}  ${ins.title}`, MARGIN + 8, titleStart + 14);

        const sevLabel = ins.severity.charAt(0).toUpperCase() + ins.severity.slice(1);
        doc.setFontSize(8);
        doc.setTextColor(sevColor);
        doc.text(sevLabel, PW - MARGIN - 4, titleStart + 14, { align: 'right' });

        y = titleStart + 22;

        if (ins.explanation) wrappedText(ins.explanation, 10, MUTED, 8);
        if (ins.action) {
          y += 2;
          setFont(9, 'bold', ACCENT);
          doc.text('Recommendation:', MARGIN + 8, y);
          y += 12;
          wrappedText(ins.action, 9, ACCENT, 8);
        }
        y += 10;
      });

      hRule(ACCENT, 0.5);
    }

    /* ── FUTURE PLAN ── */
    const planCards = document.getElementById('planCards');
    if (planCards && planCards.innerHTML.trim() && !planCards.innerHTML.includes('hidden')) {
      checkSpace(40);
      textLine('Future Plan & Projections', 14, 'bold', FG);
      y += 4;

      const projItems = document.querySelectorAll('#planCards .proj-item');
      projItems.forEach(item => {
        const label = item.querySelector('.proj-label');
        const val   = item.querySelector('.proj-value');
        const sub   = item.querySelector('.proj-sub');
        if (!label || !val) return;
        checkSpace(28);
        doc.setFillColor(isDark ? '#1A2035' : '#F1F5F9');
        doc.roundedRect(MARGIN, y, INNER, 24, 3, 3, 'F');
        setFont(9, 'bold', MUTED);
        doc.text(label.textContent.trim().toUpperCase(), MARGIN + 8, y + 10);
        setFont(10, 'bold', ACCENT);
        doc.text(val.textContent.trim(), MARGIN + 8, y + 20);
        if (sub) {
          setFont(8, 'normal', MUTED);
          doc.text(sub.textContent.trim(), PW - MARGIN - 8, y + 20, { align: 'right' });
        }
        y += 30;
      });

      const aiActions = window._aiResult && window._aiResult.actions;
      const period    = String(window._currentPlanPeriod || 30);
      if (aiActions && aiActions[period] && aiActions[period].length > 0) {
        y += 6;
        checkSpace(30);
        setFont(11, 'bold', FG);
        doc.text('Action Plan', MARGIN, y);
        y += 16;
        aiActions[period].forEach((action, i) => {
          checkSpace(20);
          wrappedText(`${i + 1}.  ${action}`, 10, MUTED, 8);
          y += 2;
        });
      }

      hRule(ACCENT, 0.5);
    }

    /* ── FOOTER on all pages ── */
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      setFont(8, 'normal', MUTED);
      doc.text('Smart Content Manager  ·  Confidential', MARGIN, PH - 20);
      doc.text(`Page ${p} of ${totalPages}`, PW - MARGIN, PH - 20, { align: 'right' });
      doc.setDrawColor(ACCENT);
      doc.setLineWidth(3);
      doc.line(0, PH - 6, PW, PH - 6);
    }

    const filename = `SCM_Report_${(creatorName || 'creator').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(filename);
    showToast('Report downloaded successfully!', 'success');

  } catch (err) {
    console.error('PDF export error:', err);
    showToast('Could not generate PDF: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Download Report'; }
  }
};
