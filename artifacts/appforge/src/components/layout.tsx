import { Link, useLocation } from "wouter";
import { Show, useClerk, useUser } from "@clerk/react";
import { useGetMe, getGetMeQueryKey } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { CreditBar } from "@/components/credit-bar";
import { LogOut, CreditCard, LayoutDashboard, Shield } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: me } = useGetMe({ query: { enabled: !!user, queryKey: getGetMeQueryKey() } });
  const isOwner = user?.primaryEmailAddress?.emailAddress === "rrhh.milchollos@gmail.com";
  const isAdmin = me?.isAdmin || isOwner;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-auto md:h-14 max-w-screen-2xl items-center flex-col md:flex-row gap-2 md:gap-0 py-2 md:py-0">
          <div className="flex px-4 md:px-8 w-full items-center justify-between">
            <Link href="/" className="flex items-center space-x-2">
              <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="Maris AI" className="h-6 w-6" />
              <span className="font-bold sm:inline-block tracking-tight text-lg bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                Maris AI
              </span>
            </Link>

            <div className="flex items-center space-x-4 w-full md:w-auto">
              <Show when="signed-in">
                <nav className="flex items-center space-x-4 text-sm font-medium">
                  <Link href="/dashboard" className="transition-colors hover:text-foreground/80 text-foreground/60">
                    Panel
                  </Link>
                  <Link href="/billing" className="transition-colors hover:text-foreground/80 text-foreground/60">
                    Facturación
                  </Link>
                  {isAdmin && (
                    <Link href="/admin" className="transition-colors hover:text-primary text-primary/80 font-semibold flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5" /> Admin
                    </Link>
                  )}
                </nav>
                
                {me && (
                  <div className="hidden sm:block">
                    <CreditBar />
                  </div>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user?.imageUrl} alt={user?.fullName || ""} />
                        <AvatarFallback>{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.fullName}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user?.primaryEmailAddress?.emailAddress}
                        </p>
                        <p className="text-xs leading-none text-muted-foreground opacity-50 mt-1 font-mono select-all">
                          ID: {user?.id}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setLocation("/dashboard")}>
                      <LayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Panel</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation("/billing")}>
                      <CreditCard className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Facturación</span>
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem onClick={() => setLocation("/admin")}>
                        <Shield className="mr-2 h-4 w-4 text-primary" />
                        <span>Panel admin</span>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => signOut(() => setLocation("/"))}>
                      <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Cerrar sesión</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Show>

              <Show when="signed-out">
                <Link href="/sign-in" className="text-sm font-medium transition-colors hover:text-foreground/80 text-foreground/60">
                  Iniciar Sesión
                </Link>
                <Link href="/sign-up">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">Comenzar</Button>
                </Link>
              </Show>
            </div>
          </div>
        </div>
        <Show when="signed-in">
          {/* Mobile credit bar */}
          <div className="sm:hidden w-full px-4 pb-2">
            <CreditBar />
          </div>
        </Show>
      </header>

      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}