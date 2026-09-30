#nullable disable

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace zen
{
    public partial class Form1 : Form
    {
        // =========================================================================
        // CONFIGURATION
        // =========================================================================
        private const string CURRENT_VERSION = "1.0.0";
        private const string GITHUB_REPO = "seanmyro/zen";             // Configured for your GitHub repo
        private const string BOT_API_URL = "http://localhost:3000/api"; // Change to domain/tunnel when hosted online
        // =========================================================================

        // Windows API hooks to allow dragging borderless window
        [DllImport("user32.dll")]
        public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HT_CAPTION = 0x2;

        private static readonly HttpClient client = new HttpClient();

        private Panel panelTitleBar;
        private Panel panelMain;
        private Panel panelLogin;
        private Panel panelRegister;

        // Theme colors (Grey Palette)
        private readonly Color bgGrey = Color.FromArgb(40, 40, 40);       // Main app grey background
        private readonly Color titleGrey = Color.FromArgb(28, 28, 28);    // Darker title bar grey
        private readonly Color inputGrey = Color.FromArgb(55, 55, 55);    // Textbox/Button grey background
        private readonly Color accentColor = Color.FromArgb(203, 166, 247); // Purple accent text

        public Form1()
        {
            InitializeComponent();
            InitializeCustomUI();
            
            // Silently check GitHub Releases for updates on application launch
            _ = CheckForGitHubUpdates();
        }

        private void InitializeCustomUI()
        {
            this.Text = "zen";
            this.Size = new Size(420, 420);
            this.BackColor = bgGrey;
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;

            CreateTitleBar();
            CreateMainPanel();
            CreateLoginPanel();
            CreateRegisterPanel();

            ShowPanel(panelMain);
        }

        // --- Hardware Identifier (HWID) Generator ---
        private string GetHWID()
        {
            string rawIdentifier = Environment.MachineName + 
                                  Environment.UserName + 
                                  Environment.ProcessorCount + 
                                  Environment.OSVersion.VersionString;

            try
            {
                using (var searcher = new System.Management.ManagementObjectSearcher("SELECT ProcessorId FROM Win32_Processor"))
                {
                    foreach (var item in searcher.Get())
                    {
                        rawIdentifier += item["ProcessorId"]?.ToString();
                        break;
                    }
                }
            }
            catch { /* Fallback to standard OS info if WMI is restricted */ }

            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(rawIdentifier));
                StringBuilder sb = new StringBuilder();
                foreach (byte b in bytes) sb.Append(b.ToString("X2"));
                return sb.ToString();
            }
        }

        // --- GitHub Releases Auto-Updater System ---
        private async Task CheckForGitHubUpdates()
        {
            try
            {
                client.DefaultRequestHeaders.UserAgent.Clear();
                client.DefaultRequestHeaders.UserAgent.ParseAdd("zen-autoupdater");

                string url = $"https://api.github.com/repos/{GITHUB_REPO}/releases/latest";
                HttpResponseMessage response = await client.GetAsync(url);
                if (!response.IsSuccessStatusCode) return;

                string json = await response.Content.ReadAsStringAsync();

                string latestTag = ExtractJsonValue(json, "tag_name").Replace("v", "").Trim();
                string downloadUrl = ExtractJsonValue(json, "browser_download_url");

                if (!string.IsNullOrEmpty(latestTag) && latestTag != CURRENT_VERSION)
                {
                    DialogResult result = MessageBox.Show(
                        $"An update (v{latestTag}) is available!\nWould you like to update automatically now?",
                        "Z E N — Update Found",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Information
                    );

                    if (result == DialogResult.Yes && !string.IsNullOrEmpty(downloadUrl))
                    {
                        PerformAutoUpdate(downloadUrl);
                    }
                }
            }
            catch { /* Offline or rate limited */ }
        }

        private string ExtractJsonValue(string json, string key)
        {
            int keyIndex = json.IndexOf($"\"{key}\":");
            if (keyIndex == -1) return "";
            int start = json.IndexOf("\"", keyIndex + key.Length + 3) + 1;
            int end = json.IndexOf("\"", start);
            if (start <= 0 || end <= start) return "";
            return json.Substring(start, end - start);
        }

        private void PerformAutoUpdate(string downloadUrl)
        {
            try
            {
                string tempExe = Path.Combine(Path.GetTempPath(), "zen_update.exe");
                string currentExe = Process.GetCurrentProcess().MainModule.FileName;

                using (WebClient wc = new WebClient())
                {
                    wc.DownloadFile(downloadUrl, tempExe);
                }

                // Batch script to wait, overwrite old exe, restart app, and self-delete
                string batchScript = Path.Combine(Path.GetTempPath(), "update_zen.bat");
                string batContent = $@"
@echo off
timeout /t 2 /nobreak > nul
move /y ""{tempExe}"" ""{currentExe}""
start """" ""{currentExe}""
del ""%~f0""
";
                File.WriteAllText(batchScript, batContent);

                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c " + batchScript)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process.Start(psi);
                Application.Exit();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to install update: {ex.Message}", "Update Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // --- Custom Title Bar ---
        private void CreateTitleBar()
        {
            panelTitleBar = new Panel
            {
                Size = new Size(420, 35),
                Dock = DockStyle.Top,
                BackColor = titleGrey
            };
            panelTitleBar.MouseDown += TitleBar_MouseDown;

            Label lblAppTitle = new Label
            {
                Text = $"zen v{CURRENT_VERSION}",
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.FromArgb(200, 200, 200),
                AutoSize = true,
                Location = new Point(12, 8)
            };
            lblAppTitle.MouseDown += TitleBar_MouseDown;

            Button btnClose = new Button
            {
                Text = "✕",
                Size = new Size(35, 35),
                Dock = DockStyle.Right,
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.Gray,
                Font = new Font("Segoe UI", 9, FontStyle.Bold)
            };
            btnClose.FlatAppearance.BorderSize = 0;
            btnClose.Click += (s, e) => Application.Exit();

            panelTitleBar.Controls.Add(lblAppTitle);
            panelTitleBar.Controls.Add(btnClose);
            this.Controls.Add(panelTitleBar);
        }

        private void TitleBar_MouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
            }
        }

        private void ShowPanel(Panel targetPanel)
        {
            panelMain.Visible = (targetPanel == panelMain);
            panelLogin.Visible = (targetPanel == panelLogin);
            panelRegister.Visible = (targetPanel == panelRegister);
        }

        // --- Main Screen ---
        private void CreateMainPanel()
        {
            panelMain = new Panel { Size = new Size(420, 385), Location = new Point(0, 35), BackColor = bgGrey };

            Label lblTitle = new Label
            {
                Text = "ZEN",
                Font = new Font("Segoe UI", 26, FontStyle.Bold),
                ForeColor = accentColor,
                AutoSize = true,
                Location = new Point(155, 30)
            };

            Button btnLogin = CreateButton("Login", new Point(110, 120), (s, e) => ShowPanel(panelLogin));
            Button btnRegister = CreateButton("Create Account", new Point(110, 185), (s, e) => ShowPanel(panelRegister));

            panelMain.Controls.Add(lblTitle);
            panelMain.Controls.Add(btnLogin);
            panelMain.Controls.Add(btnRegister);
            this.Controls.Add(panelMain);
        }

        // --- Login Screen ---
        private void CreateLoginPanel()
        {
            panelLogin = new Panel { Size = new Size(420, 385), Location = new Point(0, 35), BackColor = bgGrey, Visible = false };

            Label lblTitle = new Label { Text = "Login to ZEN", Font = new Font("Segoe UI", 18, FontStyle.Bold), ForeColor = accentColor, AutoSize = true, Location = new Point(130, 15) };

            Label lblUser = new Label { Text = "Username", ForeColor = Color.FromArgb(200, 200, 200), Location = new Point(60, 75), AutoSize = true };
            TextBox txtUser = CreateTextBox(new Point(60, 95));

            Label lblPass = new Label { Text = "Password", ForeColor = Color.FromArgb(200, 200, 200), Location = new Point(60, 140), AutoSize = true };
            TextBox txtPass = CreateTextBox(new Point(60, 160));
            txtPass.PasswordChar = '•';

            Button btnSubmit = new Button
            {
                Text = "Login",
                Size = new Size(280, 35),
                Location = new Point(60, 215),
                BackColor = Color.FromArgb(166, 227, 161),
                ForeColor = Color.Black,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat
            };
            btnSubmit.FlatAppearance.BorderSize = 0;
            btnSubmit.Click += async (s, e) =>
            {
                string user = txtUser.Text.Trim();
                string pass = txtPass.Text.Trim();
                string hwid = GetHWID();

                if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass))
                {
                    MessageBox.Show("Please enter your username and password.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                btnSubmit.Enabled = false;
                btnSubmit.Text = "Verifying...";

                bool authenticated = await AuthenticateUserApi(user, pass, hwid);

                btnSubmit.Enabled = true;
                btnSubmit.Text = "Login";

                if (authenticated)
                {
                    MessageBox.Show($"Welcome back, {user}!", "Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    // Place post-login dashboard loading or tool initialization code here
                }
            };

            Button btnBack = new Button { Text = "Back", Location = new Point(160, 265), ForeColor = Color.FromArgb(200, 200, 200), FlatStyle = FlatStyle.Flat };
            btnBack.FlatAppearance.BorderSize = 0;
            btnBack.Click += (s, e) => ShowPanel(panelMain);

            panelLogin.Controls.AddRange(new Control[] { lblTitle, lblUser, txtUser, lblPass, txtPass, btnSubmit, btnBack });
            this.Controls.Add(panelLogin);
        }

        // --- Create Account Screen ---
        private void CreateRegisterPanel()
        {
            panelRegister = new Panel { Size = new Size(420, 385), Location = new Point(0, 35), BackColor = bgGrey, Visible = false };

            Label lblTitle = new Label { Text = "Create Account", Font = new Font("Segoe UI", 18, FontStyle.Bold), ForeColor = accentColor, AutoSize = true, Location = new Point(115, 10) };

            Label lblUser = new Label { Text = "New Username", ForeColor = Color.FromArgb(200, 200, 200), Location = new Point(60, 55), AutoSize = true };
            TextBox txtUser = CreateTextBox(new Point(60, 75));

            Label lblPass = new Label { Text = "New Password", ForeColor = Color.FromArgb(200, 200, 200), Location = new Point(60, 115), AutoSize = true };
            TextBox txtPass = CreateTextBox(new Point(60, 135));
            txtPass.PasswordChar = '•';

            Label lblKey = new Label { Text = "Redeem Key", ForeColor = Color.FromArgb(200, 200, 200), Location = new Point(60, 175), AutoSize = true };
            TextBox txtKey = CreateTextBox(new Point(60, 195));

            Button btnSubmit = new Button
            {
                Text = "Register",
                Size = new Size(280, 35),
                Location = new Point(60, 240),
                BackColor = Color.FromArgb(137, 180, 250),
                ForeColor = Color.Black,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat
            };
            btnSubmit.FlatAppearance.BorderSize = 0;
            btnSubmit.Click += async (s, e) =>
            {
                string user = txtUser.Text.Trim();
                string pass = txtPass.Text.Trim();
                string key = txtKey.Text.Trim();
                string hwid = GetHWID();

                if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass) || string.IsNullOrEmpty(key))
                {
                    MessageBox.Show("All fields are required.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                btnSubmit.Enabled = false;
                btnSubmit.Text = "Registering...";

                string resultMessage = await RegisterUserApi(user, pass, key, hwid);

                btnSubmit.Enabled = true;
                btnSubmit.Text = "Register";

                if (resultMessage == "SUCCESS")
                {
                    MessageBox.Show("Account successfully created and bound to this PC!", "Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    ShowPanel(panelLogin);
                }
                else
                {
                    MessageBox.Show(resultMessage, "Registration Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };

            Button btnBack = new Button { Text = "Back", Location = new Point(160, 285), ForeColor = Color.FromArgb(200, 200, 200), FlatStyle = FlatStyle.Flat };
            btnBack.FlatAppearance.BorderSize = 0;
            btnBack.Click += (s, e) => ShowPanel(panelMain);

            panelRegister.Controls.AddRange(new Control[] { lblTitle, lblUser, txtUser, lblPass, txtPass, lblKey, txtKey, btnSubmit, btnBack });
            this.Controls.Add(panelRegister);
        }

        // --- Node.js API HTTP Integration Handlers ---
        private async Task<string> RegisterUserApi(string username, string password, string key, string hwid)
        {
            try
            {
                string jsonBody = $"{{\"username\":\"{username}\",\"password\":\"{password}\",\"key\":\"{key}\",\"hwid\":\"{hwid}\"}}";
                StringContent content = new StringContent(jsonBody, Encoding.UTF8, "application/json");

                HttpResponseMessage response = await client.PostAsync($"{BOT_API_URL}/register", content);
                string responseStr = await response.Content.ReadAsStringAsync();

                if (response.IsSuccessStatusCode && responseStr.Contains("\"success\":true"))
                {
                    return "SUCCESS";
                }
                
                string errorMsg = ExtractJsonValue(responseStr, "message");
                return string.IsNullOrEmpty(errorMsg) ? "Registration failed." : errorMsg;
            }
            catch (Exception ex)
            {
                return $"Server connection error: {ex.Message}";
            }
        }

        private async Task<bool> AuthenticateUserApi(string username, string password, string hwid)
        {
            try
            {
                string jsonBody = $"{{\"username\":\"{username}\",\"password\":\"{password}\",\"hwid\":\"{hwid}\"}}";
                StringContent content = new StringContent(jsonBody, Encoding.UTF8, "application/json");

                HttpResponseMessage response = await client.PostAsync($"{BOT_API_URL}/login", content);
                string responseStr = await response.Content.ReadAsStringAsync();

                if (response.IsSuccessStatusCode && responseStr.Contains("\"success\":true"))
                {
                    return true;
                }

                string errorMsg = ExtractJsonValue(responseStr, "message");
                MessageBox.Show(string.IsNullOrEmpty(errorMsg) ? "Invalid credentials or HWID mismatch." : errorMsg, "Auth Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Server connection error: {ex.Message}", "Connection Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return false;
        }

        // --- Helper Control Generators ---
        private Button CreateButton(string text, Point location, EventHandler onClick)
        {
            Button btn = new Button
            {
                Text = text,
                Size = new Size(180, 45),
                Location = location,
                BackColor = inputGrey,
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 11, FontStyle.Bold),
                FlatStyle = FlatStyle.Flat
            };
            btn.FlatAppearance.BorderSize = 0;
            btn.Click += onClick;
            return btn;
        }

        private TextBox CreateTextBox(Point location)
        {
            return new TextBox
            {
                Size = new Size(280, 25),
                Location = location,
                BackColor = inputGrey,
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Segoe UI", 10)
            };
        }
    }
}
