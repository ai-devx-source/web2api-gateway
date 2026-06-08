// Script interactively adds new accounts.
// Run: node scripts/addAccount.js

import { interactiveAccountMenu } from '../src/utils/accountSetup.js';

(async () => {
    await interactiveAccountMenu();
})(); 