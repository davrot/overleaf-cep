const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log("Navigating to Overleaf dev server...");
    await page.goto("https://psintern.neuro.uni-bremen.de");
    
    // Wait for login form elements
    console.log("Waiting for login form...");
    await page.waitForSelector('input[type="email"]');
    
    // Login
    console.log("Filling credentials...");
    await page.fill('input[type="email"]', 'testjoe@rotermund.at');
    await page.fill('input[type="password"]', '?.97iJlsQ4=?');
    
    // Click login button
    console.log("Clicking login...");
    await page.click('button[type="submit"]');
    
    // Wait for navigation to complete
    await page.waitForLoadState('networkidle');
    
    console.log(`Current URL: ${page.url()}`);
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/overleaf-login.png' });
    console.log("Screenshot saved to /tmp/overleaf-login.png");
    
    // Navigate to project
    console.log("Navigating to project...");
    await page.goto("https://psintern.neuro.uni-bremen.de/project/6a79d37427ef7d246ce38bd6");
    await page.waitForLoadState('networkidle');
    
    console.log(`Project URL: ${page.url()}`);
    
    // Get page title
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Take screenshot of project page
    await page.screenshot({ path: '/tmp/overleaf-project.png' });
    console.log("Project screenshot saved to /tmp/overleaf-project.png");
    
    // Try to find some common Overleaf elements
    const hasSidebar = await page.$('[data-testid="sidebar"]') !== null;
    const hasEditor = await page.$('[data-testid="editor"]') !== null;
    
    console.log(`Has sidebar (detected by data-testid): ${hasSidebar}`);
    console.log(`Has editor (detected by data-testid): ${hasEditor}`);
    
    // Log available elements for introspection
    const bodyText = await page.evaluate(() => document.body.innerText);
    const wordCount = bodyText.trim().split(/\s+/).length;
    console.log(`Body text word count: ${wordCount}`);
    
    console.log("\n=== SUCCESS ===");
    await browser.close();
    
  } catch (error) {
    console.error("Error:", error.message);
    
    // Take screenshot of error state
    try {
      await page.screenshot({ path: '/tmp/overleaf-error.png' });
      console.log("Error screenshot saved to /tmp/overleaf-error.png");
    } catch (e) {}
    
    await browser.close();
    process.exit(1);
  }
})();
