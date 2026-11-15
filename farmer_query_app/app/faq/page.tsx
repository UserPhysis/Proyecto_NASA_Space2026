import Link from "next/link";
import "../modules.css";

const faqs = [
  ["What does Know My Land do?", "It combines the selected coordinates with NASA POWER and SoilGrids readings to describe climate, rainfall, wind, soil texture and planting constraints."],
  ["What can I do in Explore?", "Explore compares regions and crops using geographic filters and map layers so you can identify where crops are commonly produced."],
  ["How does Analyze My Crops work?", "It compares historical observations, model projections and crop requirement ranges to identify acceptable or risky conditions."],
  ["Are the recommendations a final decision?", "No. They are decision support. Always validate local field observations, crop variety, soil tests and farmer priorities before planting."],
];

export default function FrequentlyAskedQuestionsPage() {
  return <main className="module-page faq-page"><header><Link href="/">← Home</Link><span className="subtle">04 / 04</span></header><span className="kicker">Frequently asked questions</span><h1>How can Farmer Query help?</h1><p className="subtle">A quick guide to the information and analysis available in each module.</p><section className="module-grid">{faqs.map(([question, answer]) => <article className="module-panel" key={question}><h2>{question}</h2><p>{answer}</p></article>)}</section></main>;
}
