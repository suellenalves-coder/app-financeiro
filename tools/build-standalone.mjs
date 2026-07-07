// Gera dist/meu-orcamento-inteligente.html: o app inteiro em um único arquivo,
// que funciona aberto direto do computador (file://), sem servidor.
// Uso: node tools/build-standalone.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Ordem respeitando dependências (cartoes antes de simulador/config).
const MODULES = [
  'js/utils.js', 'js/store.js', 'js/calc.js', 'js/charts.js', 'js/ui.js',
  'js/views/dashboard.js', 'js/views/anual.js', 'js/views/receitas.js',
  'js/views/despesas.js', 'js/views/cartoes.js', 'js/views/recorrentes.js',
  'js/views/provisoes.js', 'js/views/investimentos.js', 'js/views/reembolsos.js',
  'js/views/calendario.js', 'js/views/fechamento.js', 'js/views/simulador.js',
  'js/views/relatorios.js', 'js/views/carro.js', 'js/views/config.js',
  'js/app.js',
];

function transform(path) {
  let code = readFileSync(join(root, path), 'utf8');
  const key = basename(path, '.js');

  // import { a, b } from './x.js'  →  const { a, b } = __m['x']
  // import * as x from './x.js'    →  const x = __m['x']
  code = code.replace(/import\s+([\s\S]*?)\s+from\s+['"](.*?)['"];?/g, (_, what, from) => {
    const mod = `__m['${basename(from, '.js')}']`;
    const star = what.match(/^\*\s+as\s+(\w+)$/);
    if (star) return `const ${star[1]} = ${mod};`;
    // Em destructuring, "a as b" vira "a: b".
    return `const ${what.replace(/\s+/g, ' ').replace(/(\w+) as (\w+)/g, '$1: $2')} = ${mod};`;
  });

  // Coleta e remove os export
  const names = [];
  code = code.replace(/^export (function|const|let) (\w+)/gm, (_, kind, name) => {
    names.push(name);
    return `${kind} ${name}`;
  });

  return `__m['${key}'] = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();`;
}

const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
const js = MODULES.map(transform).join('\n\n');

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#FAF8F2">
  <title>Meu Orçamento Inteligente</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌿</text></svg>">
  <style>\n${css}\n</style>
</head>
<body>
  <div id="app" class="app"></div>
  <script>
'use strict';
const __m = {};
${js}
  </script>
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/meu-orcamento-inteligente.html');
writeFileSync(out, html);
console.log(`Gerado: ${out} (${(html.length / 1024).toFixed(0)} KB)`);
