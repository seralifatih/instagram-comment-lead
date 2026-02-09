💬 Instagram Comment Lead ScraperTurn comments into customers. Extract comments from Instagram posts or profiles, automatically detect buying intent (leads), and export data for your CRM.🎯 What This Tool DoesThis Actor scrapes comments from Instagram posts and analyzes them to find potential leads.✅ Features:Smart Lead Detection: Automatically tags comments containing keywords like "price", "dm", "how much", "link".Hybrid Input: Accepts both Post URLs (specific posts) and Profile URLs (scrapes their latest posts).Deep Scraping: Uses internal APIs to fetch hundreds of comments, not just the first 12 visible ones.Metadata Extraction: Gets commenter username, full name, like count, and timestamp.🚀 Use Cases1. Competitor Lead GenerationScrape your competitor's viral posts to see who is interested in their product.{
  "targetUrls": ["[https://www.instagram.com/p/Cush2lzNPk/](https://www.instagram.com/p/Cush2lzNPk/)"]
}
Result: A list of users asking "Price?" or "Shipping?".2. Campaign MonitoringMonitor your own influencer posts to catch questions or complaints instantly.3. Sentiment Analysis DataGather thousands of comments to train AI models or analyze brand sentiment.📥 Input ConfigurationBasic Usage:{
  "targetUrls": [
    "[https://www.instagram.com/p/Cush2lzNPk/](https://www.instagram.com/p/Cush2lzNPk/)",
    "[https://www.instagram.com/nike/](https://www.instagram.com/nike/)" 
  ],
  "maxComments": 100
}
If you provide a Profile URL (e.g., /nike/), the tool will fetch its latest 3 posts and scrape comments from them.Advanced (With Session - Recommended):Using a sessionId allows scraping significantly more data and avoids login walls.{
  "sessionId": "YOUR_INSTAGRAM_SESSION_ID",
  "targetUrls": ["[https://www.instagram.com/p/Cush2lzNPk/](https://www.instagram.com/p/Cush2lzNPk/)"],
  "maxComments": 500,
  "maxPostsPerProfile": 5
}
📊 Sample Output{
  "postUrl": "[https://www.instagram.com/p/Cush2lzNPk/](https://www.instagram.com/p/Cush2lzNPk/)",
  "shortcode": "Cush2lzNPk",
  "username": "customer_john",
  "fullName": "John Doe",
  "text": "What is the price? DM please.",
  "likeCount": 2,
  "postedAt": "2024-02-06T14:30:00.000Z",
  "isLead": true,
  "leadScore": "HIGH"
}
Key Fields:isLead: true if the comment contains buying intent keywords.leadScore: HIGH for leads, LOW for general comments.⚠️ Limitations & Rate LimitsLogin Wall: Instagram aggressively blocks access to comments without a login session. If you see errors, you must provide a valid sessionId.Rate Limits: Do not scrape thousands of posts in a minute. Use a proxy if running at scale.📞 SupportIf you encounter issues, verify your sessionId is fresh.