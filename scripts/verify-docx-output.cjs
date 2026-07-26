const fs = require('fs');
const os = require('os');
const path = require('path');
const officeParser = require('officeparser');
const { Document, Packer, Paragraph } = require('docx');

(async () => {
  const target = path.join(os.tmpdir(), 'taiji-docx-validation.docx');
  const document = new Document({
    sections: [{ children: [new Paragraph('太极 Word 交付验证'), new Paragraph('正文可以正常读取。')] }],
  });
  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(target, buffer);
  const parsed = await officeParser.parseOffice(target, { extractAttachments: false, ocr: false });
  const text = parsed.toText();
  if (!text.includes('太极 Word 交付验证')) throw new Error('DOCX validation failed: expected text was not readable');
  console.log(JSON.stringify({ target, bytes: buffer.length, extractedChars: text.length }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
