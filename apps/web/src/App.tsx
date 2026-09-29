import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./components";
import { CallbackPage } from "./pages/CallbackPage";
import { HomePage } from "./pages/HomePage";
import { InvitePage, SlugInvitePage } from "./pages/InvitePage";
import { TeacherPage } from "./pages/TeacherPage";
import { AssignmentDashboardPage } from "./pages/AssignmentDashboardPage";

export function App() {
  const { me, loading, reload } = useMe();

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<HomePage me={me} loading={loading} onGithubSaved={() => void reload()} />}
        />
        <Route path="/auth/callback" element={<CallbackPage />} />
        <Route path="/teacher" element={<TeacherPage me={me} />} />
        <Route path="/teacher/assignments/:id" element={<AssignmentDashboardPage me={me} />} />
        <Route path="/invite/:token" element={<InvitePage me={me} />} />
        <Route path="/a/:slug" element={<SlugInvitePage me={me} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
