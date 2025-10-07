import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import GlobalChat from "@/components/ai/GlobalChat";
import GlobalSidebar from "@/components/GlobalSidebar";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/router";

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  return (
    <TooltipProvider delayDuration={150}>
      <ToastProvider>
        <div className="min-h-screen flex">
          {/* Left sidebar occupies space */}
          <GlobalSidebar />
          {/* Main content area; center within remaining width */}
          <main className="flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={router.asPath}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="px-4 py-6"
                style={{ willChange: "opacity, transform" }}
              >
                <Component {...pageProps} />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        {/* Global AI chat dock and FAB */}
        <GlobalChat />
      </ToastProvider>
    </TooltipProvider>
  );
}
