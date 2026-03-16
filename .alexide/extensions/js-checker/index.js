(function (alexide) {
  alexide.registerDiagnosticProvider('javascript', function (filePath, content) {
    return Promise.resolve(alexide.parseJavaScript(content)).then(function (r) {
      if (r && r.ok) return [];
      if (!r || !r.errors || !r.errors.length) return [];
      return r.errors.map(function (e) {
        return { line: e.line, column: e.column, message: e.message || 'Syntax error', severity: 'error' };
      });
    });
  });
});
