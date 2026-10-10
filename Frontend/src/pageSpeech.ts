import type { Lang } from "./api";

export type Screen =
  | "start"
  | "language"
  | "entry"
  | "scan"
  | "ready"
  | "preferences"
  | "explore"
  | "order"
  | "staff"
  | "phrases"
  | "bill"
  | "payment"
  | "feedback";

export type PageSpeechState = {
  menuItems?: number;
  menuSections?: number;
  matchCount?: number;
  picksCount?: number;
  picksTotal?: number;
  billTotal?: number;
  billHasErrors?: boolean;
};

export const welcomeSequence: { text: string; lang: Lang }[] = [
  {
    text: "Welcome to SAHAAYA, your accessible restaurant companion. Ready to dine? Tap or press Space to begin.",
    lang: "en",
  },
  {
    text: "सहाय में आपका स्वागत है। भोजन के लिए तैयार? शुरू करने के लिए कहीं भी टैप करें या स्पेस दबाएं।",
    lang: "hi",
  },
  {
    text: "సహాయకు స్వాగతం. భోజనానికి సిద్ధంగా ఉన్నారా? ప్రారంభించడానికి ఎక్కడైనా నొక్కండి లేదా స్పేస్ బటన్ నొక్కండి.",
    lang: "te",
  },
];

export function getPageAnnouncement(
  screen: Screen,
  lang: Lang,
  state: PageSpeechState = {}
): string {
  const items = state.menuItems ?? 9;
  const sections = state.menuSections ?? 1;
  const matches = state.matchCount ?? 9;
  const picks = state.picksCount ?? 0;
  const total = Math.round(state.picksTotal ?? 0);
  const billTotal = Math.round(state.billTotal ?? 0);
  const billHasErrors = state.billHasErrors;

  if (lang === "hi") {
    switch (screen) {
      case "start":
        return "सहाय में आपका स्वागत है। भोजन के लिए तैयार? शुरू करने के लिए कहीं भी टैप करें या स्पेस दबाएं।";
      case "language":
        return "आप कैसे बातचीत करना चाहते हैं? कृपया अंग्रेजी, हिंदी, या तेलुगु कहें, या कीपैड से टाइप करें।";
      case "entry":
        return "आप मेनू कैसे पढ़ना चाहते हैं? कैमरा कहें फोटो लेने के लिए, या सैंपल मेनू कहें।";
      case "scan":
        return "कैमरा सक्रिय है। मेनू पर स्थिर रखें और कैप्चर कहें या बटन दबाएं।";
      case "ready":
        return `आपका मेनू तैयार है। मुझे ${sections} अनुभागों में ${items} व्यंजन मिले। प्राथमिकताएं सेट करने के लिए नेक्स्ट कहें।`;
      case "preferences":
        return "आज आपकी क्या पसंद है? वेज, नॉन-वेज, जैन, या कम तीखा कहें, और आगे बढ़ने के लिए नेक्स्ट कहें।";
      case "explore":
        return `यहाँ आपके लिए ${matches} व्यंजन हैं। व्यंजन चुनने के लिए उसका नाम कहें, या शॉर्टलिस्ट देखने के लिए नेक्स्ट कहें।`;
      case "order":
        return picks === 0
          ? "आपकी चुनी हुई सूची खाली है। व्यंजन जोड़ने के लिए मेनू पर वापस जाएं।"
          : `यह आपकी शॉर्टलिस्ट है जिसमें ${picks} व्यंजन हैं, कुल योग ₹${total}। वेटर को अपना आर्डर बताएं।`;
      case "staff":
        return "अपने वेटर से बात करें। वेटर की बातें यहाँ लाइव कैप्शन के रूप में दिखेंगी। आप बोल सकते हैं या टाइप कर सकते हैं।";
      case "phrases":
        return "स्टाफ से बात करने के लिए त्वरित वाक्य। किसी भी वाक्य पर टैप करें और सहाय उसे बोलकर सुनाएगा।";
      case "bill":
        if (state.billTotal !== undefined) {
          return billHasErrors
            ? "आपके बिल में संभावित त्रुटियां पाई गईं। कृपया भुगतान करने से पहले वेटर से जांच कराएं।"
            : `आपके बिल की जांच पूरी हो गई है और यह सही है। कुल योग ₹${billTotal} है।`;
        }
        return "भुगतान करने से पहले अपना बिल जांचें। बिल का फोटो अपलोड करें या सैंपल बिल आज़माएं।";
      case "payment":
        return `यूपीआई से भुगतान करें। कुल राशि ₹${billTotal || total || 0} है। आप अपने यूपीआई ऐप से भुगतान कर सकते हैं।`;
      case "feedback":
        return "आपका अनुभव कैसा रहा? 1 से 5 स्टार देकर रेटिंग दें या बोलकर अपना फीडबैक दें।";
    }
  }

  if (lang === "te") {
    switch (screen) {
      case "start":
        return "సహాయకు స్వాగతం. భోజనానికి సిద్ధంగా ఉన్నారా? ప్రారంభించడానికి ఎక్కడైనా నొక్కండి లేదా స్పేస్ బటన్ నొక్కండి.";
      case "language":
        return "మీరు ఎలా మాట్లాడాలనుకుంటున్నారు? దయచేసి ఇంగ్లీష్, హిందీ, లేదా తెలుగు అని చెప్పండి, లేదా కీప్యాడ్‌తో టైప్ చేయండి.";
      case "entry":
        return "మీరు మెనూ ఎలా చదవాలనుకుంటున్నారు? కెమెరా అనండి లేదా నమూనా మెనూ ఎంచుకోండి.";
      case "scan":
        return "కెమెరా సిద్ధంగా ఉంది. మెనూపై నిలకడగా ఉంచి క్యాప్చర్ అనండి లేదా బటన్ నొక్కండి.";
      case "ready":
        return `మీ మెనూ సిద్ధంగా ఉంది. ${sections} విభాగాలలో ${items} అంశాలు దొరికాయి. కొనసాగడానికి నెక్స్ట్ అనండి.`;
      case "preferences":
        return "ఈ రోజు మీ ఎంపిక ఏమిటి? వెజ్, నాన్-వెజ్, లేదా తక్కువ కారం అని చెప్పండి, మరియు కొనసాగడానికి నెక్స్ట్ అనండి.";
      case "explore":
        return `మీ కోసం ${matches} ఎంపికలు ఉన్నాయి. ఎంచుకోవడానికి వంటకం పేరు చెప్పండి, లేదా షార్ట్‌లిస్ట్ కోసం నెక్స్ట్ అనండి.`;
      case "order":
        return picks === 0
          ? "మీ ఎంపికల జాబితా ఖాళీగా ఉంది. వంటకాలను చేర్చడానికి మెనూకు తిరిగి వెళ్లండి."
          : `ఇది మీ షార్ట్‌లిస్ట్, ${picks} అంశాలు ఉన్నాయి, మొత్తం ₹${total}. ఆర్డర్ కోసం సేవ్ అనండి.`;
      case "staff":
        return "మీ వెయిటర్‌తో మాట్లాడండి. మాట్లాడిన సందేశాలు ఇక్కడ లైవ్ క్యాప్షన్‌లుగా కనిపిస్తాయి.";
      case "phrases":
        return "సిబ్బందితో మాట్లాడటానికి త్వరిత పదబంధాలు. ఏదైనా పదబంధాన్ని నొక్కండి మరియు సహాయ దానిని బిగ్గరగా చెబుతుంది.";
      case "bill":
        if (state.billTotal !== undefined) {
          return billHasErrors
            ? "మీ బిల్లులో కొన్ని తేడాలు కనిపించాయి. దయచేసి చెల్లించే ముందు వెయిటర్‌ను అడగండి."
            : `మీ బిల్లు తనిఖీ పూర్తయింది మరియు సరిగ్గా ఉంది. మొత్తం ₹${billTotal}.`;
        }
        return "చెల్లించే ముందు మీ బిల్లును తనిఖీ చేయండి. బిల్లు ఫోటోను అప్‌లోడ్ చేయండి లేదా నమూనా బిల్లును ప్రయత్నించండి.";
      case "payment":
        return `UPI తో చెల్లించండి. మొత్తం మొత్తం ₹${billTotal || total || 0}. మీరు మీ UPI యాప్ ద్వారా చెల్లించవచ్చు.`;
      case "feedback":
        return "మీ అనుభవం ఎలా ఉంది? 1 నుండి 5 నక్షత్రాలతో రేట్ చేయండి లేదా మీ అభిప్రాయాన్ని చెప్పండి.";
    }
  }

  // English fallback
  switch (screen) {
    case "start":
      return "Welcome to SAHAAYA, your accessible restaurant companion. Ready to dine? Tap or press Space to begin.";
    case "language":
      return "How would you like to talk? Please say English, Hindi, or Telugu, or type using the keypad.";
    case "entry":
      return "How do you want to read the menu? Say camera to take a photo, upload an image, or try our sample menu.";
    case "scan":
      return "Live camera active. Hold your device steady over the menu and say capture, or tap capture menu.";
    case "ready":
      return `Your menu is ready. I found ${items} items in ${sections} section${sections === 1 ? "" : "s"}. Say next to set preferences.`;
    case "preferences":
      return "What suits you today? Say your preferences like Veg, Non-veg, or Less spicy, and say Next to continue.";
    case "explore":
      return `Here are dishes for you. ${matches} choices match your preferences. Say a dish name to add to your picks, or say Next to view your shortlist.`;
    case "order":
      return picks === 0
        ? "Your shortlist is empty. Go back to dishes and add items to your picks."
        : `Here is your shortlist with ${picks} item${picks > 1 ? "s" : ""}, totaling ₹${total}. Review your picks, or say Save to continue.`;
    case "staff":
      return "Talk with your waiter. Spoken messages will appear here as live captions. You can speak, type, or use quick phrases.";
    case "phrases":
      return "Quick phrases to speak to staff. Tap any phrase such as Water please or Less spicy, and SAHAAYA will say it aloud.";
    case "bill":
      if (state.billTotal !== undefined) {
        return billHasErrors
          ? "We found possible mistakes on your bill. Please check with your waiter before paying."
          : `Your bill check is complete and looks correct. Total is ₹${billTotal}.`;
      }
      return "Check your bill before you pay. Upload a photo of your bill or try a sample bill to cross-check it against your picks.";
    case "payment":
      return `Pay with UPI. The total amount is ₹${billTotal || total || 0}. You can pay using your UPI app or copy the UPI ID.`;
    case "feedback":
      return "How was your experience? Rate your experience from 1 to 5 stars, or speak your feedback to help us improve.";
  }
}
