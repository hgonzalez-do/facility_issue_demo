export default function Qr() {
  const target = `${window.location.origin}/`;

  return (
    <main className="grid min-h-dvh place-items-center bg-white p-10 text-center">
      <div>
        <h1 className="text-[clamp(30px,5vw,56px)] font-semibold tracking-tighter text-slate-900">
          The Complaints Department
        </h1>
        <p className="mt-2 text-[clamp(16px,2vw,22px)] text-slate-600">
          Complain about anything. One sentence.
        </p>
        <img
          src={`/qr.svg?url=${encodeURIComponent(target)}`}
          alt="QR code linking to the complaints form"
          className="mx-auto mt-9 block w-[min(46vh,400px)]"
        />
        <p className="mt-6 font-mono text-[clamp(14px,1.6vw,19px)] break-all text-slate-500">
          {target}
        </p>
      </div>
    </main>
  );
}
