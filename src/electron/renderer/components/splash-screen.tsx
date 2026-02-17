import { useEffect, useState } from "react";

type SplashScreenProps = {
  onComplete: () => void;
};

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onComplete, 600);
    }, 1400);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className={`flex-1 flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <h1 className="font-serif text-[clamp(4rem,12vw,8rem)] font-normal text-[#e8e4dc] leading-[0.9] tracking-[-0.02em]">
        Ambient
      </h1>
    </div>
  );
}
