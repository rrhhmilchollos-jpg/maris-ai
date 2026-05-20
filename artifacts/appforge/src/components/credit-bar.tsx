import { useEffect, useState } from "react";
import { useGetMe } from "@/lib/api-client";
import { Zap, TrendingDown } from "lucide-react";

export function CreditBar() {
  const { data: me } = useGetMe();
  const [displayCredits, setDisplayCredits] = useState(me?.credits ?? 0);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (me?.credits !== displayCredits) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setDisplayCredits(me?.credits ?? 0);
        setAnimating(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [me?.credits, displayCredits]);

  const isAdmin = !!me?.isAdmin;
  const planCredits = me?.planCredits ?? 0;
  const topUpCredits = me?.topUpCredits ?? 0;
  const totalCredits = me?.credits ?? 0;
  const isLowOnCredits = !isAdmin && totalCredits <= 3;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-full ${isLowOnCredits ? 'bg-amber-500/20' : 'bg-primary/20'}`}>
          <Zap className={`h-4 w-4 ${isLowOnCredits ? 'text-amber-400' : 'text-primary'}`} />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">💎 Créditos</span>
          <span className={`text-lg font-mono font-bold leading-none ${isLowOnCredits ? 'text-amber-400' : 'text-white'} ${animating ? 'animate-pulse' : ''}`}>
            {isAdmin ? "∞" : displayCredits}
          </span>
        </div>
      </div>

      {isLowOnCredits && !isAdmin && totalCredits > 0 && (
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-[10px] text-amber-400 font-bold animate-pulse">
          Te quedan pocos créditos
        </div>
      )}
      
      {totalCredits === 0 && !isAdmin && (
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/10 text-[10px] text-red-400 font-bold">
          Sin créditos
        </div>
      )}
    </div>
  );
}
