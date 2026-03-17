(function (alexide) {
  alexide.registerRunHandler(
    { extensions: ['.js'] },
    function (filePath, context) {
      if (!context || typeof context.runCommand !== 'function') return;
      var quoted = '"' + String(filePath).replace(/\\/g, '/').replace(/"/g, '\\"') + '"';
      context.runCommand('node ' + quoted);
    }
  );
});
