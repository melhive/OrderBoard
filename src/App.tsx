import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { useEffect, useLayoutEffect } from "react";
import { currentRoute, useApp, type Route } from "./store/appStore";
import { LEGAL_VERSION } from "./legal/content";
import { AgentFab, AgentPanel } from "./agent/AgentPanel";
import { TablesScreen } from "./screens/TablesScreen";
import { OrderScreen } from "./screens/OrderScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { MenuEditorScreen } from "./screens/MenuEditorScreen";
import { AboutScreen, ChangelogScreen, LegalScreen, WelcomeGate } from "./screens/InfoScreens";
import { BottomNav, ToastHost } from "./ui/components";
import { DialogHost } from "./ui/Dialogs";
import { useBackButton, useTheme } from "./ui/hooks";

function routeKey(r: Route): string {
  return r.name === "order" ? `order-${r.tableId}` : r.name === "legal" ? `legal-${r.doc}` : r.name;
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "tables": return <TablesScreen />;
    case "order": return <OrderScreen tableId={route.tableId} />;
    case "summary": return <SummaryScreen />;
    case "settings": return <SettingsScreen />;
    case "menu": return <MenuEditorScreen />;
    case "changelog": return <ChangelogScreen />;
    case "about": return <AboutScreen />;
    case "legal": return <LegalScreen doc={route.doc} />;
  }
}

// Screens slide in from the side they "come from": forward pushes from the
// right, back reveals from the left.
const slide: Variants = {
  enter: (dir: number) => ({ x: dir > 0 ? "28%" : "-18%", opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { type: "spring", stiffness: 420, damping: 40, mass: 0.8 } },
  exit: (dir: number) => ({ x: dir > 0 ? "-18%" : "28%", opacity: 0, transition: { duration: 0.18, ease: "easeIn" } }),
};

export function App() {
  useTheme();
  useBackButton();
  const route = useApp(currentRoute);
  const navDir = useApp((s) => s.navDir);
  const needsGate = useApp((s) => s.data.settings.acceptedLegalVersion !== LEGAL_VERSION);
  const key = routeKey(route);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);

  // Escape closes the top-most layer on keyboards / desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = useApp.getState();
      if (s.dialog || s.agentOpen || s.sheetOpen) s.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showNav = route.name === "tables" || route.name === "summary";

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <AnimatePresence mode="popLayout" initial={false} custom={navDir}>
          <motion.div key={key} custom={navDir} variants={slide} initial="enter" animate="center" exit="exit" style={{ width: "100%" }}>
            <Screen route={route} />
          </motion.div>
        </AnimatePresence>
        {showNav && <BottomNav />}
        <AgentFab />
        <AgentPanel />
        <DialogHost />
        <ToastHost />
        <AnimatePresence>{needsGate && route.name !== "legal" && <WelcomeGate key="gate" />}</AnimatePresence>
      </div>
    </MotionConfig>
  );
}
