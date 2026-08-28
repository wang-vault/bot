const Guardian = require('../../lib/guardian')
const CodeHealth = require('../../lib/code-health')

module.exports = {
  name: 'selfcheck',
  aliases: ['codecheck', 'cekcode', 'diagnose', 'diagnosa'],
  category: 'assistant',
  isOwner: true,
  isPrivate: true,
  desc: 'Audit syntax, require, command, runtime, database, dan opsional test suite.',
  use: '[deep]',
  run: async (m) => {
    const deep = /^(deep|full|test)$/i.test((m.args || '').trim())
    await m.react('🔍').catch(() => {})
    await m.reply(
      deep
        ? '🛡️ Menjalankan pemeriksaan mendalam + seluruh test suite. Ini bisa memakan beberapa menit...'
        : '🛡️ Memeriksa source code, command loader, database, dan runtime...'
    )
    const report = await Guardian.runCheck({
      sock: m.sock,
      db: m.db,
      loader: m.loader,
      deep,
      notify: false,
    })
    if (!report || report.skipped) {
      return m.reply(`⏳ Self-check belum dapat dijalankan: ${report && report.reason || 'guardian belum siap'}.`)
    }
    if (report.internalError) return m.reply('❌ Self-check gagal: ' + report.internalError)
    return m.reply(CodeHealth.format(report, { maxIssues: 10 }))
  },
}
