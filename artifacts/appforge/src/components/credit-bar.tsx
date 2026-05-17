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
  const isLowOnCredits = !isAdmin && totalCredits <= 10;

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
      <div className="flex items-center gap-2">
        <div className={`p-2 rounded-full ${isLowOnCredits ? 'bg-red-500/20' : 'bg-primary/20'}`}>
          <Zap className={`h-5 w-5 ${isLowOnCredits ? 'text-red-400' : 'text-primary'}`} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Créditos disponibles</p>
          <p className={`text-2xl font-mono font-bold ${isLowOnCredits ? 'text-red-400' : 'text-white'} ${animating ? 'animate-pulse' : ''}`}>
            {isAdmin ? "∞" : displayCredits}
          </p>
        </div>
      </div>

      {!isAdmin && (
        <div className="flex-1 min-w-0">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Plan: {planCredits}</span>
            <span>Top-up: {topUpCredits}</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${
                isLowOnCredits 
                  ? 'bg-gradient-to-r from-red-500 to-red-400' 
                  : 'bg-gradient-to-r from-primary to-primary/50'
              }`}
              style={{ 
                width: `${Math.max(0, Math.min(100, (topUpCredits / Math.max(1, totalCredits + 50)) * 100))}%` 
              }}
            />
          </div>
        </div>
      )}

      {isLowOnCredits && (
        <div className="flex items-center gap-1 text-xs text-red-400 font-medium">
          <TrendingDown className="h-4 w-4" />
          Bajo
        </div>
      )}
    </div>
  );
}
