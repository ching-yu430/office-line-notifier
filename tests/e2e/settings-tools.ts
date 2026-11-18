import type {Page} from '@playwright/test';
export async function openSettingsTab(page:Page,tab:'general'|'records'|'maintenance'){
 const label={general:'一般設定',records:'操作紀錄',maintenance:'資料維護'}[tab];
 if(!await page.getByRole('tab',{name:label,exact:true}).isVisible())await page.getByRole('button',{name:'系統管理',exact:true}).click();
 await page.getByRole('tab',{name:label,exact:true}).click();
}
