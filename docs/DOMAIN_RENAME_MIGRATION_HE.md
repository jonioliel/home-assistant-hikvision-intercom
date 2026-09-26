# החלטת תאימות: שמירת domain קיים

ההצעה לשנות את המזהה הטכני `hikvision_intercom` ל־domain אחר ב־v2.0.0-rc.1 **בוטלה**. חבילת RC1 לא התאימה לעדכון HACS של התקנה קיימת, משום ש־HACS חיפשה את `custom_components/hikvision_intercom/manifest.json`. Home Assistant קושרת למזהה זה גם רשומות תחנות, ישויות וקובצי נתונים; שינויו אינו שינוי שם תצוגה בלבד.

מהדורת `v2.0.0-rc.2` משאירה את כל המזהים הטכניים הקיימים: תיקיית האינטגרציה, manifest, שירותים, WebSocket, נתיבי מצלמה ושמע, פאנל וקובצי `.storage`. השמות הגלויים ב־Home Assistant וב־HACS הם **smplwise access control**, והממשק ממשיך להציג **WisKey**. אין לבצע הסבת domain ואין למחוק תחנות או משתמשים כדי לעדכן.

לפתרון שגיאת ההורדה מ־RC1 ולבדיקות לאחר העדכון, ראה [מדריך ההתאוששות של HACS](HACS_DOMAIN_MIGRATION_HE.md). להוספת יצרנים בעתיד ראה [מסמך המיתוג ותאימות היצרנים](BRAND_AND_VENDOR_COMPATIBILITY_HE.md).