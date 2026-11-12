// Which population a test file belongs to, from its source text.
//   child  it starts the subject in another process (matches `childPattern`): UNMEASURED by both
//          operators, which only reach the test process itself
//   lib    it imports a module from a subject folder
//   other  it imports no repository module
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function classify(src, { subjects = ['lib', 'bin', 'tools', 'src'], childPattern = null } = {}) {
  if (childPattern && childPattern.test(src)) return 'child';
  const dirs = subjects.map(esc).join('|');
  const rel = `(?:\\.\\.?/)+(?:${dirs})/`;
  const imports = new RegExp(`from ['"]${rel}|import\\(['"\`]${rel}|require\\(['"]${rel}|new URL\\(['"]${rel}[^'"]+\\.[cm]?js['"], import\\.meta\\.url\\)`);
  return imports.test(src) ? 'lib' : 'other';
}
