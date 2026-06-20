import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1440 } });
  
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Navigate to game - CPU battle
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find(b => b.textContent.includes('CPU'))?.click();
  });
  await page.waitForTimeout(1500);
  
  // Pick a scenario
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find(b => b.textContent.includes('基本🏆'))?.click();
  });
  await page.waitForTimeout(1500);
  
  // Start game
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find(b => b.textContent.includes('ゲーム開始'))?.click();
  });
  
  // Wait longer for initial setup and player 0's turn
  for (let i = 0; i < 30; i++) {
    const hasActionBtns = await page.$('.action-buttons') !== null;
    if (hasActionBtns) {
      console.log('Action buttons found after', i, 'seconds');
      break;
    }
    await page.waitForTimeout(1000);
    if (i % 5 === 0) console.log('Waiting... ', i);
  }
  
  // Check what we have
  const gameState = await page.evaluate(() => {
    const actionBtns = document.querySelector('.action-buttons') !== null;
    const turnPanel = document.querySelector('.turn-panel') !== null;
    const placementUI = document.querySelector('[class*="placement"]') !== null;
    return { actionBtns, turnPanel, placementUI };
  });
  
  console.log('Game state:', gameState);
  
  // Take full screenshot
  await page.screenshot({ path: '/tmp/full-game.png', fullPage: false });
  console.log('Full screenshot saved');
  
  // Try to find road button
  const roadBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const roadBtn = btns.find(b => b.textContent.includes('道') || (b.querySelector('img[src*="road"]')));
    if (roadBtn) {
      const rect = roadBtn.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, found: true };
    }
    return { found: false };
  });
  
  console.log('Road button search:', roadBtn);
  
  await browser.close();
})();
