import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("MAQLAMA_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      throw new Error("MAQLAMA_SERVICE_ROLE_KEY غير موجود");
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "غير مصرح بالدخول" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // عميل المستخدم الحالي للتحقق من جلسة الأدمن
    const userClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const {
      data: { user: currentUser },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !currentUser) {
      return new Response(
        JSON.stringify({ error: "جلسة الدخول غير صالحة" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // عميل Service Role - لا يصل للمتصفح
    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    // التأكد أن المستخدم الحالي Admin
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (profile?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "ليس لديك صلاحية لإضافة الطلاب" }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const body = await req.json();

    const action = body.action;
    const role = body.role || "student";
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim().toLowerCase();

    if (action !== "create") {
      return new Response(
        JSON.stringify({ error: "عملية غير مدعومة" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (role !== "student") {
      return new Response(
        JSON.stringify({ error: "هذه الوظيفة مخصصة لإضافة الطلاب فقط" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!email || !email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "البريد الإلكتروني غير صحيح" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!name || !username) {
      return new Response(
        JSON.stringify({ error: "الاسم واسم المستخدم مطلوبان" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // التأكد من عدم تكرار اسم المستخدم
    const { data: existingUsername } = await adminClient
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUsername) {
      return new Response(
        JSON.stringify({ error: "اسم المستخدم مستخدم بالفعل" }),
        {
          status: 409,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // إنشاء الحساب مباشرة من Admin API
    // email_confirm = true يمنع الاعتماد على رسالة تأكيد البريد
    const { data: created, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          name,
          avatar: name.charAt(0),
          role: "student",
        },
      });

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "تم إنشاء الطالب بنجاح",
        user: {
          id: created.user?.id,
          email: created.user?.email,
          name,
          username,
        },
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "حدث خطأ غير معروف",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});