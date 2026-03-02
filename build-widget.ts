export {};

const agentRoot = new URL('.', import.meta.url).pathname;

const result = await Bun.build({
  entrypoints: [`${agentRoot}src/widget/index.tsx`],
  outdir: `${agentRoot}dist`,
  naming: 'widget.js',
  target: 'browser',
  format: 'iife',
  minify: true,
  sourcemap: 'none',
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  external: []
});

if (!result.success) {
  console.error('Widget build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const outputFile = result.outputs[0];
const sizeKB = (outputFile.size / 1024).toFixed(1);
console.log(`Widget built successfully: dist/widget.js (${sizeKB} KB)`);
