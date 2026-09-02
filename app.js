const SUPABASE_URL = "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_KEY = "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE";

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

      () => {
        reject(
          new Error("Please allow GPS/location permission.")
        );
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}


/* =========================
   DISTANCE CALCULATION
========================= */

function distanceMeters(lat1, lon1, lat2, lon2) {

  const R = 6371000;

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );

  return R * c;
}


/* =========================
   CAMERA
========================= */

async function takePhoto() {

  try {

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {

      throw new Error("Camera is not supported by this browser.");
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

    throw new Error(
      "Please allow camera permission."
    );
  }
}


/* =========================
   UPLOAD PHOTO
========================= */

async function uploadPhoto(blob, type) {

  const fileName =
    `${currentUser.id}/${Date.now()}-${type}.jpg`;

  const { error } = await db.storage
    .from("attendance-photos")
    .upload(fileName, blob, {
      contentType: "image/jpeg",
      upsert: false
    });

  if (error) {
    throw new Error(
      "Photo upload failed: " + error.message
    );
  }

  return fileName;
}


/* =========================
   GET WORK LOCATION
========================= */

async function getWorkLocation() {

  const { data, error } = await db
    .from("work_locations")
    .select("*")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      "Could not load work location: " + error.message
    );
  }

  if (!data) {
    throw new Error(
      "No active work location has been created by the admin."
    );
  }

  return data;
}


/* =========================
   CHECK GPS
========================= */

async function verifyLocation(gps) {

  const location = await getWorkLocation();

  const distance = distanceMeters(
    gps.lat,
    gps.lng,
    Number(location.latitude),
    Number(location.longitude)
  );

  const allowed =
    Number(location.allowed_radius_meters || 100);

  if (distance > allowed) {

    throw new Error(
      `You are outside the work area. ` +
      `Distance: ${Math.round(distance)}m. ` +
      `Allowed: ${allowed}m.`
    );
  }

  return location;
}


/* =========================
   FIND EMPLOYEE
========================= */

async function findEmployee() {

  const code = $("employeeCode").value.trim();

  if (!code) {
    throw new Error("Enter your employee code.");
  }

  const { data, error } = await db
    .from("employees")
    .select("*")
    .eq("employee_code", code)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(
      "Employee lookup failed: " + error.message
    );
  }

  if (!data) {
    throw new Error(
      "Employee code not found."
    );
  }

  if (data.user_id !== currentUser.id) {

    throw new Error(
      "This employee code is not linked to your account."
    );
  }

  currentEmployee = data;

  return data;
}


/* =========================
   SIGN IN
========================= */

async function signIn() {

  status("Checking employee and GPS...");

  try {

    const employee = await findEmployee();

    const gps = await getGPS();

    const location = await verifyLocation(gps);

    status("Location verified. Opening camera...");

    const photo = await takePhoto();

    status("Uploading attendance photo...");

    const photoPath =
      await uploadPhoto(photo, "clock-in");

    const { data: attendance, error } = await db
      .from("attendance")
      .insert({
        employee_id: employee.id,
        work_location_id: location.id,
        clock_in: new Date().toISOString(),
        clock_in_latitude: gps.lat,
        clock_in_longitude: gps.lng,
        clock_in_photo_url: photoPath,
        status: "present"
      })
      .select()
      .single();

    if (error) {
      throw new Error(
        "Sign in failed: " + error.message
      );
    }

    await db
      .from("attendance_locations")
      .insert({
        attendance_id: attendance.id,
        employee_id: employee.id,
        latitude: gps.lat,
        longitude: gps.lng,
        accuracy_meters: gps.accuracy
      });

    await db
      .from("attendance_photos")
      .insert({
        attendance_id: attendance.id,
        employee_id: employee.id,
        photo_url: photoPath,
        photo_type: "clock_in"
      });

    status(
      "Sign in successful at " +
      new Date().toLocaleTimeString()
    );

    loadMyHistory();

  } catch (error) {

    status(error.message, false);
  }
}


/* =========================
   SIGN OUT
========================= */

async function signOut() {

  status("Checking your attendance...");

  try {

    const employee = await findEmployee();

    const { data: openAttendance, error } = await db
      .from("attendance")
      .select("*")
      .eq("employee_id", employee.id)
      .is("clock_out", null)
      .order("clock_in", {
        ascending: false
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(
        "Could not find attendance: " + error.message
      );
    }

    if (!openAttendance) {
      throw new Error(
        "No open sign-in was found."
      );
    }

    const gps = await getGPS();

    const location = await verifyLocation(gps);

    status("Location verified. Opening camera...");

    const photo = await takePhoto();

    status("Uploading attendance photo...");

    const photoPath =
      await uploadPhoto(photo, "clock-out");

    const clockOut =
      new Date();

    const clockIn =
      new Date(openAttendance.clock_in);

    const totalMinutes =
      Math.round(
        (clockOut - clockIn) / 60000
      );

    const { error: updateError } = await db
      .from("attendance")
      .update({
        clock_out: clockOut.toISOString(),
        clock_out_latitude: gps.lat,
        clock_out_longitude: gps.lng,
        clock_out_photo_url: photoPath,
        total_minutes: totalMinutes,
        status: "completed"
      })
      .eq("id", openAttendance.id);

    if (updateError) {
      throw new Error(
        "Sign out failed: " +
        updateError.message
      );
    }

    await db
      .from("attendance_locations")
      .insert({
        attendance_id: openAttendance.id,
        employee_id: employee.id,
        latitude: gps.lat,
        longitude: gps.lng,
        accuracy_meters: gps.accuracy
      });

    await db
      .from("attendance_photos")
      .insert({
        attendance_id: openAttendance.id,
        employee_id: employee.id,
        photo_url: photoPath,
        photo_type: "clock_out"
      });

    status(
      `Sign out successful. Worked ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    );

    loadMyHistory();

  } catch (error) {

    status(error.message, false);
  }
}


/* =========================
   EMPLOYEE HISTORY
========================= */

async function loadMyHistory() {

  if (!currentEmployee) return;

  const { data, error } = await db
    .from("attendance")
    .select("*")
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

  const date =
    $("filterDate").value;

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

  const { data, error } =
    await query;

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
   AUTHENTICATION
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
      "Could not load profile.",
      false
    );

    return;
  }

  currentProfile =
    data;

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
      `Welcome, ${currentProfile.full_name}`;

    await loadEmployee();

  }
}


/* =========================
   LOAD EMPLOYEE
========================= */

async function loadEmployee() {

  const { data, error } =
    await db
      .from("employees")
      .select("*")
      .eq("user_id", currentUser.id)
      .maybeSingle();

  if (error) {

    status(
      "Could not load employee record.",
      false
    );

    return;
  }

  currentEmployee =
    data;

  if (currentEmployee) {

    $("employeeCode").value =
      currentEmployee.employee_code;

    $("employeeCode").disabled =
      true;

    await loadMyHistory();

  } else {

    status(
      "Your account is not linked to an employee record.",
      false
    );
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

$("loginBtn").onclick =
  login;

$("logoutBtn").onclick =
  logout;

$("adminLogoutBtn").onclick =
  logout;

$("signInBtn").onclick =
  signIn;

$("signOutBtn").onclick =
  signOut;

$("filterDate").onchange =
  loadAdminDashboard;

$("exportBtn").onclick =
  exportCSV;


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

    currentUser =
      session.user;

    await loadUserProfile();

  } else {

    $("authView").hidden = false;
    $("employeeView").hidden = true;
    $("adminView").hidden = true;
  }
}

startApp();
