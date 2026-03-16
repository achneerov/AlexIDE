(function (alexide) {
  alexide.registerFileViewer(
    { extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.svg'] },
    function (filePath, containerEl, showCodeView) {
      containerEl.innerHTML = '<div style="padding:12px;color:#999;">Loading…</div>';
      var p = alexide.getFileDataUrl ? alexide.getFileDataUrl(filePath) : alexide.getFileUrl(filePath);
      Promise.resolve(p).then(function (url) {
        if (!url) {
          containerEl.innerHTML = '<div style="padding:12px;color:#c00;">Could not load image</div>';
          return;
        }
        var img = document.createElement('img');
        img.src = url;
        img.alt = filePath.split(/[/\\]/).pop();
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.onerror = function () {
          containerEl.innerHTML = '<div style="padding:12px;color:#c00;">Failed to load image</div>';
        };
        img.onload = function () {
          containerEl.innerHTML = '';
          containerEl.appendChild(img);
        };
        containerEl.innerHTML = '';
        containerEl.appendChild(img);
      }).catch(function (err) {
        containerEl.innerHTML = '<div style="padding:12px;color:#c00;">Error: ' + (err && err.message ? err.message : String(err)) + '</div>';
      });
    }
  );
});
