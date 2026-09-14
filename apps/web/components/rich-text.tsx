import { textBlocks } from "@/lib/venue-info";

/** Menampilkan teks bebas dari admin sebagai paragraf dan daftar. React meng-escape isinya. */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`rich-text ${className}`.trim()}>
      {textBlocks(text).map((block, index) =>
        block.kind === "p" ? <p key={index}>{block.text}</p>
        : block.kind === "ul" ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
        : <ol key={index}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ol>,
      )}
    </div>
  );
}
