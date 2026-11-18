import type {Page} from '@playwright/test';
export async function openPickups(page:Page){const button=page.getByRole('button',{name:/^待領取物品 \d+ 筆$/});if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
export async function openNotes(page:Page){const button=page.getByRole('button',{name:'內部備註',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
export async function openDemoTools(page:Page){const details=page.locator('.chat-demo-tools');if(await details.getAttribute('open')===null)await details.locator('summary').click();}
