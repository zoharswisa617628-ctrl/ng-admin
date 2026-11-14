# New Gamers Admin על Cloudflare (חינם)

האתר עולה לכתובת משלו, ונכנסים אליו רק עם התחברות דרך דיסקורד.

## מה יש פה

| קובץ | מה הוא עושה |
|---|---|
| `public/index.html` | האתר עצמו. נוצר מ-`../index.html` על ידי `build.ps1`, אל תערוך אותו ידנית |
| `public/shim.js` | מחבר את האתר לשרת שלנו במקום ל-claude.ai, ומציג את מסך ההתחברות |
| `public/access.html` | דף ההרשאות (רק לבעלים): מתן גישה בלי רול, חסימה, ומי התחבר |
| `functions/auth/*` | התחברות עם דיסקורד ובדיקת הרול בשרת |
| `functions/api/*` | שמירה וקריאה של הנתונים, עם בדיקה שאתה מחובר ולא חסום |
| `schema.sql` | הטבלאות במסד הנתונים (D1) |
| `wrangler.toml` | ההגדרות: ה-ID של השרת, הרולים והבעלים |

## מי נכנס

1. מי שמופיע ב-`OWNER_IDS` נכנס תמיד, והוא גם יכול לנהל הרשאות.
2. מי שחסום בדף ההרשאות לא נכנס. החסימה פועלת מיד.
3. מי שקיבל "גישה בלי רול" בדף ההרשאות נכנס.
4. כל השאר: נכנס רק אם יש לו אחד מהרולים שב-`ROLE_IDS` בשרת הדיסקורד. הבדיקה נעשית בכל התחברות. ההתחברות תקפה 3 ימים.

## הקמה (פעם אחת)

1. **Cloudflare:** לפתוח חשבון חינמי ב-cloudflare.com.
2. **אפליקציה בדיסקורד:** ב-discord.com/developers/applications לוחצים New Application ונותנים שם.
   - ב-OAuth2 מעתיקים את **Client ID**.
   - לוחצים Reset Secret ומעתיקים את **Client Secret**. לא שולחים אותו לאף אחד.
   - ב-Redirects מוסיפים: `https://YOUR-PROJECT.pages.dev/auth/callback`. אם השם תפוס, מכניסים את הכתובת שהתקבלה.
3. **מהדיסקורד** (צריך להדליק Developer Mode בהגדרות, תחת Advanced):
   - Server ID: קליק ימני על השרת ואז Copy Server ID.
   - Role ID של רול ההנהלה: Server Settings, אחר כך Roles, קליק ימני על הרול ואז Copy Role ID.
   - ה-Discord ID שלך.
4. **העלאה:** צריך Node.js. אחרי זה הפקודות הן:
   ```
   npx wrangler login
   npx wrangler d1 create ng-admin            # את ה-database_id ממלאים ב-wrangler.toml
   npx wrangler d1 execute ng-admin --remote --file=schema.sql
   npx wrangler pages project create ng-admin --production-branch=main
   npx wrangler pages secret put DISCORD_CLIENT_SECRET --project-name=ng-admin
   npx wrangler pages secret put SESSION_SECRET --project-name=ng-admin   # מחרוזת אקראית ארוכה
   powershell -File build.ps1
   npx wrangler pages deploy
   ```

## עדכון האתר אחרי שינוי

```
powershell -File build.ps1
npx wrangler pages deploy
```

## מגבלות המסלול החינמי

- 100,000 בקשות ביום. כל דפדפן פתוח בודק שינויים כל 8 שניות, וכשהטאב מוסתר הוא לא בודק.
- D1: חמישה מיליון קריאות ומאה אלף כתיבות ביום, ו-5GB.

זה מספיק בשפע להנהלה.
