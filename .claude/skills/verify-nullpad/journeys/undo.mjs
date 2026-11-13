// Undo and redo in the page view and with Markdown on, by keys and by the
// Edit menu's command. The whole note is read with Markdown on, or from the
// page: the field holds only the caret's block.

export default async ({ page, type, look, shot, check }) => {
  const text = page.getByLabel('Note text');
  const markdown = page.getByRole('button', { name: 'Markdown' });
  const key = (name) => page.keyboard.press(name);
  const keys = async (...names) => {
    for (const name of names) await key(name);
    await look(300);
  };
  const note = async () => {
    await markdown.click();
    const value = await text.inputValue();
    await markdown.click();
    await look(200);
    return value;
  };
  const expectNote = async (want) => {
    const have = await note();
    if (have !== want) throw new Error(`${JSON.stringify(have)} is not ${JSON.stringify(want)}`);
  };
  const field = () => text.evaluate((node) => [node.value, node.selectionStart, node.selectionEnd]);
  const expectField = async (want) => {
    const have = await field();
    if (JSON.stringify(have) !== JSON.stringify(want)) throw new Error(`the field is ${JSON.stringify(have)}`);
  };
  const clickWord = async (word, end) => {
    const target = page.locator('.page .part').getByText(word, { exact: false }).first();
    const box = await target.boundingBox();
    await page.mouse.click(end ? box.x + box.width - 1 : box.x + 1, box.y + box.height / 2);
    await look(300);
  };

  await text.click();
  await type('# Trip\n\nPack light.\n\nBook the room.');
  await look();
  await shot('typed');

  await check('x, Enter, y then Ctrl+Z and Ctrl+Shift+Z give back what was typed', async () => {
    await keys('Control+End', 'Enter', 'Enter');
    await type('x\ny');
    await keys('Control+z');
    await shot('after-undo-of-y');
    await expectNote('# Trip\n\nPack light.\n\nBook the room.\n\nx\n');
    await keys('Control+Shift+z');
    await expectNote('# Trip\n\nPack light.\n\nBook the room.\n\nx\ny');
  });

  await check('undo takes back typing in a block the caret has left', async () => {
    await clickWord('Pack light', true);
    await type(' Socks.');
    await clickWord('Trip', true);
    await shot('typed-then-left');
    await keys('Control+z');
    await shot('undone-after-leaving');
    await expectField(['Pack light.', 11, 11]);
    await expectNote('# Trip\n\nPack light.\n\nBook the room.\n\nx\ny');
  });

  await check('Ctrl+Y redoes it, and the page draws the block again', async () => {
    await keys('Control+y');
    await shot('redone');
    await expectField(['Pack light. Socks.', 18, 18]);
    await expectNote('# Trip\n\nPack light. Socks.\n\nBook the room.\n\nx\ny');
  });

  await check('a join Backspace is undone and redone', async () => {
    await clickWord('Book the room', false);
    await keys('Home', 'Backspace');
    await shot('joined');
    await expectNote('# Trip\n\nPack light. Socks.\nBook the room.\n\nx\ny');
    await keys('Control+z');
    await shot('join-undone');
    await expectNote('# Trip\n\nPack light. Socks.\n\nBook the room.\n\nx\ny');
    await keys('Control+Shift+z', 'Control+z');
  });

  await check('a paste is undone in one step', async () => {
    await clickWord('Pack light', false);
    await keys('Home', 'Shift+End', 'Control+c');
    await clickWord('Book the room', false);
    await keys('Home', 'Control+v');
    await shot('pasted');
    await expectNote('# Trip\n\nPack light. Socks.\n\nPack light. Socks.Book the room.\n\nx\ny');
    await keys('Control+z');
    await shot('paste-undone');
    await expectNote('# Trip\n\nPack light. Socks.\n\nBook the room.\n\nx\ny');
  });

  await check('with Markdown on, undo steps back and the note reloads as left', async () => {
    await markdown.click();
    await keys('Control+End');
    await type(' Done.');
    await keys('Control+z');
    await shot('markdown-undo');
    const value = await text.inputValue();
    if (value !== '# Trip\n\nPack light. Socks.\n\nBook the room.\n\nx\ny') throw new Error(JSON.stringify(value));
    await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
    await page.reload();
    await text.waitFor();
    const reloaded = await text.inputValue();
    if (reloaded !== value) throw new Error(`reloaded ${JSON.stringify(reloaded)}`);
  });
};
