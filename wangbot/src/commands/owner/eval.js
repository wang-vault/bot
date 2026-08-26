const util = require('util')

module.exports = {
  name: 'eval',
  aliases: ['=>', 'evaluate'],
  category: 'owner',
  isOwner: true,
  desc: 'Evaluasi kode JavaScript (Owner only).',
  use: '<kode js>',
  run: async (m) => {
    if (!m.args) return m.reply('Contoh: ' + m.config.prefix + 'eval 1+1')
    let result
    try {
      const { sock, conn, db, config, func, loader } = m
      const noAsync = m.args.trim()
      // eslint-disable-next-line no-eval
      result = await eval('(async () => { return (' + noAsync + ') })()')
    } catch (e) {
      result = String(e)
    }
    let out = typeof result === 'string' ? result : util.inspect(result, { depth: 2 })
    if (out.length > 3800) out = out.slice(0, 3800) + '\n... (truncated)'
    await m.reply('```' + out + '```')
  },
}
