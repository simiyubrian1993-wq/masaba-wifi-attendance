const SUPABASE_URL = "https://odbigbhipnorbjjgrcrp.supabase.co";
const SUPABASE_KEY = "sb_publishable_vfpsT7i-gWJx4LfLbdMRjA_nUO-l3E8";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let currentEmployee = null;
let stream = null;


/* =========================
   STATUS
========================= */

function status(text, ok = true) {
  $("status").textContent = text;
  $("status").className = "status " + (ok ? "ok" : "error");
}

function loginStatus(text, ok = true) {
  $("loginStatus").textContent = text;
  $("loginStatus").className = "status " + (ok ? "ok" : "error");
}


/* =========================
   GPS
========================= */

function getGPS() {
  return new Promise((resolve, reject) => {

    if (!navigator.geolocation) {
      reject(new Error("GPS is not supported on this phone."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy)
        });
      },

      error => {
        if (error.code === 1) {
          reject(new Error("Please allow location permission."));
        } else if (error.code === 2) {
          reject(new Error("Unable to determine your location."));
        } else {
          reject(new Error("GPS request timed out. Try again."));
        }
      },

      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  });
}


/* =========================
   CAMERA
========================= */

async function takePhoto() {

  try {

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera is not supported.");
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user"
      },
      audio: false
    });

    $("video").srcObject = stream;
    $("video").hidden = false;

    await new Promise(resolve => setTimeout(resolve, 800));

    const video = $("video");
    const canvas = $("canvas");

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    canvas.getContext("2d").drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, "image/jpeg", 0.7)
    );

    $("preview").src = URL.createObjectURL(blob);
    $("preview").hidden = false;

    stream.getTracks().forEach(track => track.stop());

    stream = null;
    $("video").hidden = true;

    return blob;

  } catch (error) {

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    throw new Error("Please allow camera permission.");
  }
}


/* =========================
   UPLOAD PHOTO
========================= */

async function uploadPhoto(blob, type) {

  if (!currentUser) {
    throw new Error("You are not logged in.");
  }

  const fileName =
    `${currentUser.id}/${Date.now()}-${type}.jpg`;

  const { error } = await db.storage
    .from("attendance-photos")
    .upload(fileName, blob, {
      contentType: "image/jpeg",
      upsert: false
    });

  if (error) {
    throw new Error("Photo upload failed: " + error.message);
  }

  return fileName;
}


/* =========================
   WORK LOCATION
========================= */

async function getWorkLocation() {

  const { data, error } = await db
    .from("work_locations")
    .select("*")
    .eq("id", "a305302f-a919-44a8-9867-6a8d725c5c9b")
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(
      "Could not load workplace: " + error.message
    );
  }

  if (!data) {
    throw new Error("Masaba Investment workplace not found.");
  }

  return data;
}


/* =========================
   GPS VERIFICATION
========================= */

async function verifyLocation(gps) {

  const location = await getWorkLocation();

  const { data, error } = await db.rpc(
    "check_workplace_location",
    {
      p_latitude: gps.lat,
      p_longitude: gps.lng,
      p_location_id: location.id
    }
  );

  if (error) {
    throw new Error(
      "GPS verification failed: " + error.message
    );
  }

  if (!data) {

    const distanceText =
      location.allowed_radius_meters
        ? `within ${location.allowed_radius_meters} metres`
        : "within the allowed area";

    throw new Error(
      `You are outside Masaba Investment. You must be ${distanceText}.`
    );
  }

  return location;
}


/* =========================
   FIND EMPLOYEE
========================= */

async function findEmployee() {

  if (!currentUser) {
    throw new Error("Please login first.");
  }

  const { data, error } = await db
    .from("employees")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(
      "Employee lookup failed: " + error.message
    );
  }

  if (!data) {
    throw new Error(
      "Your account is not linked to an active employee."
    );
  }

  currentEmployee = data;

  $("employeeCode").value = data.employee_code;
  $("employeeCode").disabled = true;

  return data;
}


/* =========================
   SIGN IN
========================= */

async function signIn() {

  $("signInBtn").disabled = true;
  status("Checking your GPS...");

  try {

    const employee = await findEmployee();

    const gps = await getGPS();

    status(
      `GPS found. Accuracy: ${gps.accuracy}m. Checking workplace...`
    );

    const location = await verifyLocation(gps);

    status(
      "Location verified. Opening camera..."
    );

    const photo = await takePhoto();

    status("Uploading attendance photo...");

    const photoPath =
      await uploadPhoto(photo, "clock-in");

    status("Recording your sign in...");

    const { data: attendanceId, error } =
      await db.rpc(
        "clock_in_employee",
        {
          p_employee_id: employee.id,
          p_latitude: gps.lat,
          p_longitude: gps.lng,
          p_photo_url: photoPath
        }
      );

    if (error) {

      await db.storage
        .from("attendance-photos")
        .remove([photoPath]);

      throw new Error(
        "Sign in failed: " + error.message
      );
    }

    status(
      "✅ Sign in successful at " +
      new Date().toLocaleTimeString()
    );

    await loadMyHistory();

  } catch (error) {

    status(error.message, false);

  } finally {

    $("signInBtn").disabled = false;
  }
}


/* =========================
   SIGN OUT
========================= */

async function signOut() {

  $("signOutBtn").disabled = true;
  status("Checking your GPS...");

  try {

    const employee = await findEmployee();

    const gps = await getGPS();

    status(
      `GPS found. Accuracy: ${gps.accuracy}m. Checking workplace...`
    );

    await verifyLocation(gps);

    status("Location verified. Opening camera...");

    const photo = await takePhoto();

    status("Uploading attendance photo...");

    const photoPath =
      await uploadPhoto(photo, "clock-out");

    status("Recording your sign out...");

    const { data: attendanceId, error } =
      await db.rpc(
        "clock_out_employee",
        {
          p_employee_id: employee.id,
          p_latitude: gps.lat,
          p_longitude: gps.lng,
          p_photo_url: photoPath
        }
      );

    if (error) {

      await db.storage
        .from("attendance-photos")
        .remove([photoPath]);

      throw new Error(
        "Sign out failed: " + error.message
      );
    }

    status(
      "✅ Sign out successful at " +
      new Date().toLocaleTimeString()
    );

    await loadMyHistory();

  } catch (error) {

    status(error.message, false);

  } finally {

    $("signOutBtn").disabled = false;
  }
}


/* =========================
   EMPLOYEE HISTORY
========================= */

async function loadMyHistory() {

  if (!currentEmployee) return;

  const { data, error } = await db
    .from("attendance")
    .select(`
      *,
      work_locations (
        name
      )
    `)
    .eq("employee_id", currentEmployee.id)
    .order("clock_in", {
      ascending: false
    });

  if (error) {

    $("myHistory").innerHTML =
      `<p>Could not load attendance history.</p>`;

    return;
  }

  if (!data || data.length === 0) {

    $("myHistory").innerHTML =
      `<p>No attendance records yet.</p>`;

    return;
  }

  $("myHistory").innerHTML = `
    <div class="tableWrap">
      <table>

        <tr>
          <th>Date</th>
          <th>Sign In</th>
          <th>Sign Out</th>
          <th>Hours</th>
          <th>Status</th>
        </tr>

        ${data.map(row => {

          const hours =
            row.total_minutes == null
              ? "Open"
              : (
                Math.floor(row.total_minutes / 60)
                + "h "
                + (row.total_minutes % 60)
                + "m"
              );

          return `
            <tr>

              <td>
                ${new Date(row.clock_in).toLocaleDateString()}
              </td>

              <td>
                ${new Date(row.clock_in).toLocaleTimeString()}
              </td>

              <td>
                ${
                  row.clock_out
                    ? new Date(row.clock_out).toLocaleTimeString()
                    : "—"
                }
              </td>

              <td>${hours}</td>

              <td>${row.status}</td>

            </tr>
          `;

        }).join("")}

      </table>
    </div>
  `;
}


/* =========================
   ADMIN DASHBOARD
========================= */

async function loadAdminDashboard() {

  const date = $("filterDate").value;

  let query = db
    .from("attendance")
    .select(`
      *,
      employees (
        name,
        employee_code
      )
    `)
    .order("clock_in", {
      ascending: false
    });

  if (date) {

    query = query
      .gte("clock_in", `${date}T00:00:00`)
      .lt("clock_in", `${date}T23:59:59`);
  }

  const { data, error } = await query;

  if (error) {

    $("adminTable").innerHTML =
      `<p>Could not load records: ${error.message}</p>`;

    return;
  }

  const rows = data || [];

  const totalMinutes =
    rows.reduce(
      (sum, row) =>
        sum + Number(row.total_minutes || 0),
      0
    );

  $("stats").innerHTML = `
    <div class="stat">
      <small>Records</small>
      <b>${rows.length}</b>
    </div>

    <div class="stat">
      <small>Completed</small>
      <b>${rows.filter(r => r.clock_out).length}</b>
    </div>

    <div class="stat">
      <small>Total Hours</small>
      <b>${(totalMinutes / 60).toFixed(2)}</b>
    </div>
  `;

  if (!rows.length) {

    $("adminTable").innerHTML =
      `<p>No attendance records.</p>`;

    return;
  }

  $("adminTable").innerHTML = `
    <div class="tableWrap">
      <table>

        <tr>
          <th>Employee</th>
          <th>Sign In</th>
          <th>Sign Out</th>
          <th>Hours</th>
          <th>GPS</th>
        </tr>

        ${rows.map(row => {

          const employee =
            row.employees || {};

          const hours =
            row.total_minutes == null
              ? "Open"
              : (
                Math.floor(row.total_minutes / 60)
                + "h "
                + (row.total_minutes % 60)
                + "m"
              );

          return `
            <tr>

              <td>
                ${employee.name || "Unknown"}
                <br>
                <small>
                  ${employee.employee_code || ""}
                </small>
              </td>

              <td>
                ${new Date(row.clock_in).toLocaleString()}
              </td>

              <td>
                ${
                  row.clock_out
                    ? new Date(row.clock_out).toLocaleString()
                    : "—"
                }
              </td>

              <td>${hours}</td>

              <td>
                ${row.clock_in_latitude},
                ${row.clock_in_longitude}
              </td>

            </tr>
          `;

        }).join("")}

      </table>
    </div>
  `;
}


/* =========================
   EXPORT CSV
========================= */

async function exportCSV() {

  const { data, error } =
    await db
      .from("attendance")
      .select(`
        *,
        employees (
          name,
          employee_code
        )
      `)
      .order("clock_in", {
        ascending: false
      });

  if (error) {

    alert(
      "Could not export records: " +
      error.message
    );

    return;
  }

  const head = [
    "Employee",
    "Employee Code",
    "Sign In",
    "Sign Out",
    "Minutes",
    "In Latitude",
    "In Longitude",
    "Out Latitude",
    "Out Longitude"
  ];

  const rows = [
    head,
    ...(data || []).map(row => [
      row.employees?.name || "",
      row.employees?.employee_code || "",
      row.clock_in || "",
      row.clock_out || "",
      row.total_minutes || "",
      row.clock_in_latitude || "",
      row.clock_in_longitude || "",
      row.clock_out_latitude || "",
      row.clock_out_longitude || ""
    ])
  ];

  const csv =
    rows
      .map(row =>
        row.map(value =>
          `"${String(value).replaceAll('"', '""')}"`
        ).join(",")
      )
      .join("\n");

  const blob =
    new Blob([csv], {
      type: "text/csv"
    });

  const link =
    document.createElement("a");

  link.href =
    URL.createObjectURL(blob);

  link.download =
    "masaba-attendance.csv";

  link.click();
}


/* =========================
   LOGIN
========================= */

async function login() {

  const email =
    $("loginEmail").value.trim();

  const password =
    $("loginPassword").value;

  if (!email || !password) {

    loginStatus(
      "Enter your email and password.",
      false
    );

    return;
  }

  loginStatus("Logging in...");

  const { data, error } =
    await db.auth.signInWithPassword({
      email,
      password
    });

  if (error) {

    loginStatus(
      "Login failed: " + error.message,
      false
    );

    return;
  }

  currentUser =
    data.user;

  await loadUserProfile();
}


/* =========================
   PROFILE
========================= */

async function loadUserProfile() {

  const { data, error } =
    await db
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

  if (error) {

    loginStatus(
      "Could not load profile: " + error.message,
      false
    );

    return;
  }

  currentProfile = data;

  if (!currentProfile) {

    loginStatus(
      "Your account has no profile.",
      false
    );

    return;
  }

  $("authView").hidden = true;

  if (currentProfile.role === "admin") {

    $("adminView").hidden = false;
    $("employeeView").hidden = true;

    await loadAdminDashboard();

  } else {

    $("adminView").hidden = true;
    $("employeeView").hidden = false;

    $("welcomeText").textContent =
      `Welcome, ${currentProfile.full_name || "Employee"}`;

    await loadEmployee();
  }
}


/* =========================
   LOAD EMPLOYEE
========================= */

async function loadEmployee() {

  try {

    await findEmployee();

    status("Ready to sign in.");

    await loadMyHistory();

  } catch (error) {

    status(error.message, false);
  }
}


/* =========================
   LOGOUT
========================= */

async function logout() {

  await db.auth.signOut();

  currentUser = null;
  currentProfile = null;
  currentEmployee = null;

  $("authView").hidden = false;
  $("employeeView").hidden = true;
  $("adminView").hidden = true;

  $("loginPassword").value = "";

  loginStatus("You have been logged out.");
}


/* =========================
   BUTTONS
========================= */

$("loginBtn").onclick = login;
$("logoutBtn").onclick = logout;
$("adminLogoutBtn").onclick = logout;
$("signInBtn").onclick = signIn;
$("signOutBtn").onclick = signOut;
$("filterDate").onchange = loadAdminDashboard;
$("exportBtn").onclick = exportCSV;


/* =========================
   START APP
========================= */

async function startApp() {

  const {
    data: {
      session
    }
  } = await db.auth.getSession();

  if (session?.user) {

    currentUser = session.user;

    await loadUserProfile();

  } else {

    $("authView").hidden = false;
    $("employeeView").hidden = true;
    $("adminView").hidden = true;
  }
}

startApp();
