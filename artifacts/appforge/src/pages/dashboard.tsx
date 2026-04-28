import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useGetMyStats, useListApps, useGenerateApp, getGetMyStatsQueryKey, getListAppsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { Sparkles, Code2, Plus, ArrowRight, Loader2, Cpu } from "lucide-react";

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: apps, isLoading: appsLoading } = useListApps();
  
  const generateMutation = useGenerateApp({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        setPrompt("");
        toast({ title: "App Generated!", description: "Your app is ready to view." });
        setLocation(`/app/${data.id}`);
      },
      onError: (error: any) => {
        toast({ 
          title: "Generation Failed", 
          description: error.message || "Failed to generate app.", 
          variant: "destructive" 
        });
      }
    }
  });

  // Pre-fill prompt from local storage if coming from landing page
  useEffect(() => {
    const saved = localStorage.getItem("appforge_pending_prompt");
    if (saved) {
      setPrompt(saved);
      localStorage.removeItem("appforge_pending_prompt");
    }
  }, []);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    
    if (stats && stats.credits <= 0) {
      toast({
        title: "Out of credits",
        description: "Please purchase more credits to generate apps.",
        variant: "destructive",
      });
      setLocation("/billing");
      return;
    }

    generateMutation.mutate({ data: { prompt } });
  };

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Credits Remaining</CardTitle>
              <Cpu className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-3xl font-bold font-mono text-primary">{stats?.credits}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Apps Generated</CardTitle>
              <Code2 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-3xl font-bold font-mono">{stats?.appsGenerated}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Spent</CardTitle>
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-3xl font-bold font-mono text-muted-foreground">{stats?.creditsSpentTotal}</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Generator Box */}
        <Card className="border-primary/20 bg-card/60 backdrop-blur shadow-lg overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent"></div>
          <CardHeader>
            <CardTitle className="text-xl flex items-center">
              <Sparkles className="h-5 w-5 text-primary mr-2" />
              Generate New Application
            </CardTitle>
            <CardDescription>Describe what you want to build in detail. Be specific about features, layout, and styling.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="space-y-4">
              <Textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A sleek habit tracker with daily checkboxes, a progress chart, and dark mode support..." 
                className="min-h-[120px] bg-background/50 border-border/50 font-sans text-base focus-visible:ring-primary/50"
                disabled={generateMutation.isPending}
                data-testid="input-prompt"
              />
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground font-mono bg-background/50 px-2 py-1 rounded">Cost: 1 Credit</p>
                {stats && stats.credits <= 0 ? (
                  <Button type="button" onClick={() => setLocation("/billing")} variant="destructive" data-testid="button-out-of-credits">
                    Out of Credits <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button 
                    type="submit" 
                    disabled={generateMutation.isPending || !prompt.trim()} 
                    className="min-w-[140px] bg-primary text-white hover:bg-primary/90"
                    data-testid="button-generate"
                  >
                    {generateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        Generate App <Plus className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Recent Apps */}
        <div>
          <h3 className="text-xl font-semibold mb-4 flex items-center">
            <Code2 className="h-5 w-5 mr-2 text-muted-foreground" />
            Recent Apps
          </h3>
          
          {appsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
          ) : apps && apps.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {apps.map(app => (
                <Card 
                  key={app.id} 
                  className="bg-card/40 border-white/5 hover:border-primary/50 transition-all cursor-pointer group hover:bg-card/60 flex flex-col"
                  onClick={() => setLocation(`/app/${app.id}`)}
                  data-testid={`card-app-${app.id}`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg truncate group-hover:text-primary transition-colors">{app.title}</CardTitle>
                    <CardDescription className="line-clamp-2 min-h-[2.5rem]">{app.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-4 pb-4">
                    <div className="flex gap-2 mb-2 flex-wrap">
                      {app.techStack?.slice(0, 3).map(tech => (
                        <Badge key={tech} variant="outline" className="bg-background/50 border-white/10 text-xs text-muted-foreground">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0 text-xs text-muted-foreground flex justify-between items-center border-t border-white/5 mt-auto bg-black/10 py-3">
                    <span>{formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}</span>
                    <span className="text-primary/70 group-hover:text-primary transition-colors font-medium">View Code →</span>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 px-4 border border-dashed border-white/10 rounded-xl bg-card/20">
              <Code2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <h4 className="text-lg font-medium text-foreground mb-1">No apps generated yet</h4>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                Use the prompt box above to command the neural engine and build your first application.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}