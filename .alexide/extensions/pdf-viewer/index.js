(function (alexide) {
  alexide.registerFileViewer(
    { extensions: ['.pdf'] },
    function (filePath, containerEl, showCodeView) {
      containerEl.innerHTML = '<div style="padding:12px;color:#999;">Loading PDF…</div>';
      var p = alexide.getFileArrayBuffer ? alexide.getFileArrayBuffer(filePath) : Promise.resolve(null);
      Promise.resolve(p).then(function (data) {
        if (!data || !data.length) {
          containerEl.innerHTML = '<div style="padding:12px;color:#c00;">Could not load PDF</div>';
          return;
        }
        var base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
        function runRender(pdfjsLib) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = base + '/pdf.worker.min.js';
          renderPdf(data, containerEl, pdfjsLib);
        }
        if (typeof pdfjsLib !== 'undefined') {
          runRender(pdfjsLib);
          return;
        }
        var script = document.createElement('script');
        script.src = base + '/pdf.min.js';
        script.onload = function () {
          if (typeof pdfjsLib !== 'undefined') runRender(pdfjsLib);
          else containerEl.innerHTML = '<div style="padding:12px;color:#c00;">PDF.js failed to load</div>';
        };
        script.onerror = function () {
          containerEl.innerHTML = '<div style="padding:12px;color:#c00;">Could not load PDF viewer</div>';
        };
        document.head.appendChild(script);
      }).catch(function (err) {
        containerEl.innerHTML = '<div style="padding:12px;color:#c00;">Error: ' + (err && err.message ? err.message : String(err)) + '</div>';
      });
    }
  );

  function renderPdf(data, containerEl, pdfjsLib) {
    containerEl.innerHTML = '<div style="padding:12px;color:#999;">Rendering PDF…</div>';
    var src = data && data.length ? { data: data } : null;
    if (!src) {
      containerEl.innerHTML = '<div style="padding:12px;color:#c00;">Could not load PDF</div>';
      return;
    }
    pdfjsLib.getDocument(src).promise.then(function (pdf) {
      containerEl.innerHTML = '';
      var scale = 1.5;
      var numPages = pdf.numPages;
      function renderPage(pageNum) {
        pdf.getPage(pageNum).then(function (page) {
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          canvas.style.display = 'block';
          canvas.style.marginBottom = '8px';
          containerEl.appendChild(canvas);
          page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport });
        }).catch(function () {});
      }
      for (var i = 1; i <= numPages; i++) renderPage(i);
    }).catch(function (err) {
      containerEl.innerHTML = '<div style="padding:12px;color:#c00;">PDF error: ' + (err && err.message ? err.message : 'Unknown') + '</div>';
    });
  }
});
