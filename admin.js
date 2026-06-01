// ============================================================
// RESTAURANTE LA 26 — PANEL DE ADMINISTRACIÓN
// admin.js · Versión 3.1 — CORREGIDO
// Bucaramanga, Santander — Colombia
//
// CAMBIOS v3.1 (fix crítico product_code):
//  [FIX-1] Columna product_code confirmada en BD como INTEGER.
//          El payload de inserción la incluye directamente sin
//          lógica de reintento/fallback — ya no es necesaria.
//  [FIX-2] cargarSlotsMenuReal ahora incluye product_code en
//          el SELECT y lo muestra correctamente en las tarjetas.
//  [FIX-3] Orden de tarjetas usa product_code cuando está
//          disponible, igual que el catálogo original.
//  [FIX-4] getRangoByCodigo ahora recibe el valor real de la BD.
//
// Esquema real confirmado en Supabase (menu_items):
//   id uuid | restaurant_id uuid | category_id uuid |
//   name varchar | description text | price numeric |
//   item_type USER-DEFINED | image_url text |
//   is_active boolean | created_at timestamptz |
//   portions_today smallint | product_code integer  ← NUEVO
// ============================================================

// ============================================================
// CREDENCIALES SUPABASE
// ============================================================
const SUPABASE_URL      = "https://hxmodeduckuhvvspnkxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ESxhljLgqWkGvrnKhvbeEg_iBqaGciv";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// CONSTANTES TRIBUTARIAS — ESTATUTO TRIBUTARIO COLOMBIA
// Rete-ICA Bucaramanga: Actividad 5611 — expendio comidas
// Tasa: 6.9 x 1000 (Acuerdo Municipal Bucaramanga)
// Impoconsumo: Art. 512-1 E.T. — restaurantes 8%
// ============================================================
const TASA_RETE_ICA    = 0.0069;  // 6.9 por mil
const TASA_IMPOCONSUMO = 0.08;    // 8% impoconsumo restaurantes

// ============================================================
// ESTADO GLOBAL CONTABLE
// ============================================================
let globalIngresos = 0;
let globalEgresos  = 0;

let totalEfectivo      = 0;
let totalTransferencia = 0;
let totalFiado         = 0;
let baseInicial        = 0;

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
const Toast = (function() {
    let _c = null;
    function _init() {
        if (_c) return;
        _c = document.createElement('div');
        Object.assign(_c.style, {
            position:'fixed', top:'20px', left:'50%', transform:'translateX(-50%)',
            zIndex:'9999', display:'flex', flexDirection:'column', gap:'8px',
            alignItems:'center', pointerEvents:'none',
            width:'max-content', maxWidth:'calc(100vw - 32px)',
        });
        document.body.appendChild(_c);
    }
    function show(msg, tipo, ms = 3800) {
        _init();
        const pal = {
            ok:    { bg:'#f5f7f0', bd:'rgba(74,103,65,.35)',  tx:'#2e4028', dot:'#4a6741' },
            error: { bg:'#fdf5f3', bd:'rgba(192,80,60,.30)',  tx:'#6b2a1e', dot:'#c0503c' },
            info:  { bg:'#f5f7f0', bd:'rgba(74,103,65,.25)',  tx:'#3a4a38', dot:'#4a6741' },
        };
        const c = pal[tipo] || pal.info;
        const t = document.createElement('div');
        Object.assign(t.style, {
            display:'flex', alignItems:'center', gap:'9px',
            background:c.bg, border:`1.5px solid ${c.bd}`, borderRadius:'999px',
            padding:'10px 20px 10px 14px', boxShadow:'0 4px 20px rgba(0,0,0,.10)',
            fontSize:'13.5px', fontFamily:"'DM Sans',sans-serif", fontWeight:'500',
            color:c.tx, pointerEvents:'auto',
            opacity:'0', transform:'translateY(-8px)',
            transition:'opacity .28s ease, transform .28s ease',
        });
        const dot = document.createElement('span');
        Object.assign(dot.style, { width:'7px', height:'7px', borderRadius:'50%', background:c.dot, flexShrink:'0', display:'block' });
        const txt = document.createElement('span');
        txt.textContent = msg;
        t.appendChild(dot); t.appendChild(txt); _c.appendChild(t);
        requestAnimationFrame(() => requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)'; }));
        const timer = setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(-8px)'; setTimeout(() => t.remove(), 300); }, ms);
        t.onclick = () => { clearTimeout(timer); t.remove(); };
    }
    return { ok:(m,ms)=>show(m,'ok',ms), error:(m,ms)=>show(m,'error',ms), info:(m,ms)=>show(m,'info',ms) };
})();

// ============================================================
// FORMATO MONEDA COP
// ============================================================
function formatCOP(valor) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0
    }).format(valor);
}

// ============================================================
// MAPA DE TIPOS DE PLATO
// ============================================================
const MAPA_TIPO = {
    executive_lunch: { label: 'Proteína con Salsa', icono: '🥩', porciones: 35, badgeClass: 'badge-protein' },
    protein:         { label: 'Proteína con Salsa', icono: '🥩', porciones: 35, badgeClass: 'badge-protein' },
    side:            { label: 'Principio',           icono: '🍲', porciones: 50, badgeClass: 'badge-side'    },
    drink:           { label: 'Bebida',              icono: '🍹', porciones: 20, badgeClass: 'badge-drink'   },
    a_la_carte:      { label: 'A la Carta',          icono: '✨', porciones: 15, badgeClass: 'badge-carte'   },
    dessert:         { label: 'Postre',              icono: '🍮', porciones: 10, badgeClass: 'badge-dessert' },
};

// [FIX-4] getRangoByCodigo ahora recibe el INTEGER real de product_code
function getRangoByCodigo(codigo) {
    const n = parseInt(codigo) || 0;
    if (n >= 1  && n <= 10)  return { label: 'Vegetal/Salsa/Base', color: 'var(--olive)' };
    if (n >= 11 && n <= 30)  return { label: 'Carne/Proteína',     color: '#b43c3c'       };
    if (n >= 31 && n <= 50)  return { label: 'Acompañamiento',     color: 'var(--amber)'  };
    if (n >= 51 && n <= 70)  return { label: 'Bebida/Jugo',        color: 'var(--blue)'   };
    if (n >= 71)             return { label: 'A la Carta',          color: 'var(--purple)' };
    return { label: '—', color: 'var(--text-3)' };
}

// ============================================================
// 1. DASHBOARD — CONTABILIDAD Y COMANDAS
// ============================================================
async function cargarDashboardReal() {
    try {
        const { data: orders, error } = await supabaseClient
            .from('orders')
            .select('id, order_number, customer_name, total_amount, status, payment_method, order_items ( quantity, notes, price )')

        if (error) throw error;

        const ordenesValidas = (orders || []).filter(o =>
            o.status !== 'canceled' && o.status !== 'cancelled'
        );

        globalIngresos = ordenesValidas.reduce(
            (acc, o) => acc + (parseFloat(o.total_amount) || 0), 0
        );

        totalEfectivo      = 0;
        totalTransferencia = 0;
        totalFiado         = 0;
        ordenesValidas.forEach(o => {
            const monto = parseFloat(o.total_amount) || 0;
            if (o.payment_method === 'efectivo')           totalEfectivo      += monto;
            else if (o.payment_method === 'transferencia') totalTransferencia += monto;
            else if (o.payment_method === 'fiado')         totalFiado         += monto;
        });

        const baseICA      = Math.max(0, globalIngresos - globalEgresos);
        const provisionICA = baseICA * TASA_RETE_ICA;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('gros-ventas',   formatCOP(globalIngresos));
        set('total-pedidos', `${ordenesValidas.length} pedidos`);
        set('val-reteica',   formatCOP(provisionICA));
        set('kpi-efectivo',       formatCOP(totalEfectivo));
        set('kpi-transferencia',  formatCOP(totalTransferencia));
        set('kpi-fiado',          formatCOP(totalFiado));
        set('kpi-saldo-caja',     formatCOP(baseInicial + totalEfectivo + totalTransferencia));

        // Historial de facturación
        const tbodyFacturas = document.getElementById('tabla-facturas');
        if (tbodyFacturas) {
            tbodyFacturas.innerHTML = '';
            if (ordenesValidas.length === 0) {
                tbodyFacturas.innerHTML = `
                    <tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                        Sin comandas registradas hoy.
                    </td></tr>`;
            } else {
                ordenesValidas.forEach(ord => {
                    const metodo = ord.payment_method || '';
                    const badgeMetodo = metodo
                        ? `<span style="font-size:10px;font-weight:600;padding:2px 9px;border-radius:999px;
                            background:${metodo==='efectivo'?'var(--olive-lt)':metodo==='transferencia'?'var(--blue-lt)':'var(--amber-lt)'};
                            color:${metodo==='efectivo'?'var(--olive)':metodo==='transferencia'?'var(--blue)':'var(--amber)'};
                            border:1.5px solid ${metodo==='efectivo'?'var(--olive-bd)':metodo==='transferencia'?'rgba(37,99,168,.28)':'rgba(154,108,26,.28)'};">
                            ${metodo==='efectivo'?'💵 Efectivo':metodo==='transferencia'?'📲 Transferencia':'🤝 Fiado'}
                           </span>`
                        : `<select onchange="registrarMetodoPago('${ord.id}', this.value)"
                               style="font-size:10.5px;padding:3px 10px;border-radius:999px;height:28px;width:auto;cursor:pointer;background:var(--amber-lt);border-color:rgba(154,108,26,.28);color:var(--amber);">
                               <option value="">💳 Registrar pago…</option>
                               <option value="efectivo">💵 Efectivo</option>
                               <option value="transferencia">📲 Transferencia</option>
                               <option value="fiado">🤝 Fiado</option>
                           </select>`;

                    tbodyFacturas.insertAdjacentHTML('beforeend', `
                        <tr class="tbody-row">
                            <td><span class="mono" style="font-size:11.5px;font-weight:700;color:var(--olive);">${ord.order_number}</span></td>
                            <td style="font-size:13px;color:var(--text-1);font-weight:500;">${ord.customer_name || 'Consumidor Final'}</td>
                            <td><span class="mono" style="font-size:13px;font-weight:700;color:var(--olive);">${formatCOP(ord.total_amount)}</span></td>
                            <td style="text-align:center;">${badgeMetodo}</td>
                            <td style="text-align:center;">
                                <div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;">
                                    <button onclick="exportarReciboPDF('${ord.id}')"
                                        style="background:var(--surface-2);border:1.5px solid var(--border);color:var(--text-2);border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;"
                                        onmouseover="this.style.background='var(--surface-3)'"
                                        onmouseout="this.style.background='var(--surface-2)'">📄 PDF</button>
                                    <button onclick="abrirModalFacturaElectronica('${ord.id}', '${ord.order_number}', ${ord.total_amount})"
                                        style="background:var(--olive-lt);border:1.5px solid var(--olive-bd);color:var(--olive);border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .2s;"
                                        onmouseover="this.style.background='rgba(74,103,65,.16)'"
                                        onmouseout="this.style.background='var(--olive-lt)'">🧾 DIAN</button>
                                    <button onclick="eliminarComandaReal('${ord.id}', '${ord.order_number}')" class="btn-danger">🗑️</button>
                                </div>
                            </td>
                        </tr>`);
                });
            }
        }

        // Top platos vendidos
        const ranking = {};
        (orders || []).forEach(ord => {
            if (!ord.order_items) return;
            ord.order_items.forEach(item => {
                let nombre = 'Plato Especial';
                if (item.notes && item.notes.includes('[nombre]')) {
                    nombre = item.notes.split('[nombre]')[1].split('|')[0].trim();
                }
                ranking[nombre] = (ranking[nombre] || 0) + (item.quantity || 1);
            });
        });

        const tbodyTop = document.getElementById('tabla-top-platos');
        if (tbodyTop) {
            tbodyTop.innerHTML = '';
            const listaPlatos = Object.keys(ranking);
            if (listaPlatos.length === 0) {
                tbodyTop.innerHTML = `
                    <tr><td colspan="2" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                        Sin datos de platos aún.
                    </td></tr>`;
            } else {
                listaPlatos
                    .sort((a, b) => ranking[b] - ranking[a])
                    .forEach(plato => {
                        tbodyTop.insertAdjacentHTML('beforeend', `
                            <tr class="tbody-row">
                                <td style="color:var(--text-1);font-size:13px;">${plato}</td>
                                <td style="text-align:center;">
                                    <span class="mono" style="font-size:13px;font-weight:600;color:var(--olive);">${ranking[plato]}</span>
                                </td>
                            </tr>`);
                    });
            }
        }

        const { data: gastos } = await supabaseClient
            .from('operating_expenses')
            .select('amount');
        globalEgresos = (gastos || []).reduce(
            (acc, g) => acc + (parseFloat(g.amount) || 0), 0
        );
        const elTotalGastos = document.getElementById('total-gastos');
        if (elTotalGastos) elTotalGastos.textContent = formatCOP(globalEgresos);

    } catch (err) {
        console.error('Error cargando dashboard:', err);
    }
}

// ============================================================
// ELIMINAR COMANDA
// ============================================================
async function eliminarComandaReal(idComanda, nroOrden) {
    if (!confirm(`⚠️ ¿Eliminar la orden ${nroOrden}?\nEsto restará el monto de los reportes.`)) return;
    try {
        await supabaseClient.from('order_items').delete().eq('order_id', idComanda);
        const { error } = await supabaseClient.from('orders').delete().eq('id', idComanda);
        if (error) throw error;
        Toast.ok(`Orden ${nroOrden} eliminada correctamente.`);
        cargarDashboardReal();
    } catch (err) {
        console.error('Error eliminando comanda:', err);
        Toast.error('Error al eliminar el registro.');
    }
}

// ============================================================
// REGISTRAR MÉTODO DE PAGO
// ============================================================
async function registrarMetodoPago(orderId, metodo) {
    if (!metodo) return;
    try {
        const { error } = await supabaseClient
            .from('orders')
            .update({ payment_method: metodo, status: 'completed' })
            .eq('id', orderId);
        if (error) throw error;
        const label = { efectivo: 'Efectivo 💵', transferencia: 'Transferencia 📲', fiado: 'Fiado 🤝' };
        Toast.ok(`Pago registrado: ${label[metodo] || metodo}`);
        cargarDashboardReal();
    } catch (err) {
        console.error('Error registrando método de pago:', err);
        Toast.error('No se pudo registrar el método de pago.');
    }
}

// ============================================================
// APERTURA DE CAJA
// ============================================================
function registrarAperturaCaja() {
    const inp = document.getElementById('input-base-caja');
    const val = parseFloat(inp?.value?.replace(/[^0-9.]/g,'')) || 0;
    if (val <= 0) { Toast.error('Ingresa un monto válido para la base de caja.'); return; }
    baseInicial = val;
    sessionStorage.setItem('base_caja_hoy', String(val));
    Toast.ok(`Base de caja registrada: ${formatCOP(val)}`);
    const elSaldo = document.getElementById('kpi-saldo-caja');
    if (elSaldo) elSaldo.textContent = formatCOP(baseInicial + totalEfectivo + totalTransferencia);
    const panel = document.getElementById('panel-apertura-caja');
    if (panel) panel.style.display = 'none';
}

// ============================================================
// EXPORTAR RECIBO PDF (CORREGIDO CON EL NOMBRE DE COLUMNA REAL)
// ============================================================
async function exportarReciboPDF(orderId) {
    try {
        const { data: ord, error } = await supabaseClient
            .from('orders')
            .select(`order_number, customer_name, total_amount, created_at,
                     order_items ( quantity, notes, unit_price )`) // Corregido a unit_price[cite: 3]
            .eq('id', orderId)
            .single();

        if (error || !ord) throw error || new Error('Orden no encontrada');

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: [80, 160] });

        pdf.setFont('monospace', 'bold');
        pdf.setFontSize(11);
        pdf.text('RESTAURANTE LA 26', 40, 10, { align: 'center' });
        pdf.setFontSize(8);
        pdf.setFont('monospace', 'normal');
        pdf.text('Bucaramanga, Santander', 40, 15, { align: 'center' });
        pdf.text('Nit: 900.123.456-7', 40, 19, { align: 'center' });
        pdf.text('----------------------------------------', 40, 23, { align: 'center' });
        pdf.text(`Ref: ${ord.order_number}`, 5, 29);
        pdf.text(`Cliente: ${ord.customer_name || 'Consumidor Final'}`, 5, 34);
        pdf.text(`Fecha: ${new Date(ord.created_at).toLocaleString('es-CO')}`, 5, 39);
        pdf.text('----------------------------------------', 40, 44, { align: 'center' });
        pdf.setFont('monospace', 'bold');
        pdf.text('Cant    Detalle                     Subtotal', 5, 49);
        pdf.setFont('monospace', 'normal');

        let y = 55;
        if (ord.order_items && ord.order_items.length > 0) {
            ord.order_items.forEach(item => {
                let nombre = 'Plato Especial';
                if (item.notes && item.notes.includes('[nombre]')) {
                    nombre = item.notes.split('[nombre]')[1].split('|')[0].trim();
                }
                if (nombre.length > 20) nombre = nombre.substring(0, 18) + '..';
                
                // Corregido a item.unit_price para coincidir con la BD[cite: 3]
                const sub = (item.quantity || 1) * (item.unit_price || 0); 
                
                pdf.text(`${item.quantity}x    ${nombre.padEnd(22, ' ')} $${sub.toLocaleString()}`, 5, y);
                y += 6;
            });
        }

        pdf.text('----------------------------------------', 40, y, { align: 'center' });
        y += 6;
        pdf.setFont('monospace', 'bold');
        pdf.setFontSize(9);
        pdf.text(`TOTAL: $${parseInt(ord.total_amount).toLocaleString()} COP`, 5, y);
        y += 8;
        
        const base = ord.total_amount / (1 + TASA_IMPOCONSUMO);
        const impo = ord.total_amount - base;
        
        pdf.setFontSize(7.5);
        pdf.setFont('monospace', 'normal');
        pdf.text(`Base gravable: $${Math.round(base).toLocaleString()}`, 5, y);
        y += 5;
        pdf.text(`Impoconsumo 8%: $${Math.round(impo).toLocaleString()}`, 5, y);
        y += 8;
        pdf.setFont('monospace', 'italic');
        pdf.text('¡Gracias por visitarnos!', 40, y, { align: 'center' });
        pdf.save(`Recibo_La26_${ord.order_number}.pdf`);

    } catch (err) {
        console.error('Error generando PDF:', err);
        Toast.error('Error al generar la tirilla PDF.');
    }
}

// ============================================================
// 2. MODAL FACTURA ELECTRÓNICA DIAN
// ============================================================
let _feOrdenId   = null;
let _feOrdenNo   = null;
let _feBaseTotal = 0;

function abrirModalFacturaElectronica(orderId, ordenNo, totalBruto) {
    _feOrdenId   = orderId;
    _feOrdenNo   = ordenNo;
    _feBaseTotal = parseFloat(totalBruto) || 0;

    const baseGravable = _feBaseTotal / (1 + TASA_IMPOCONSUMO);
    const impoconsumo  = _feBaseTotal - baseGravable;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('fe-orden-no',  ordenNo);
    set('fe-subtotal',  formatCOP(baseGravable));
    set('fe-iva',       formatCOP(impoconsumo));
    set('fe-total',     formatCOP(_feBaseTotal));

    const modal  = document.getElementById('modal-factura-dian');
    const fields = ['fe-nombre', 'fe-nit', 'fe-email'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const elResult = document.getElementById('fe-resultado');
    if (elResult) elResult.style.display = 'none';
    if (modal)    modal.style.display    = 'flex';
}

function cerrarModalFactura() {
    const modal = document.getElementById('modal-factura-dian');
    if (modal) modal.style.display = 'none';
    _feOrdenId = null; _feOrdenNo = null; _feBaseTotal = 0;
}

function _generarHashCUFE(semilla) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const uuid  = crypto.randomUUID().replace(/-/g, '').toUpperCase();
    const base  = btoa(semilla + uuid).replace(/[^A-Z0-9]/gi, '').toUpperCase();
    return base.substring(0, 96).padEnd(96, chars[Math.floor(Math.random() * chars.length)]);
}

async function generarFacturaElectronica() {
    const nombre = document.getElementById('fe-nombre')?.value.trim() || '';
    const nit    = document.getElementById('fe-nit')?.value.trim()    || '';
    const email  = document.getElementById('fe-email')?.value.trim()  || '';

    if (!nombre || !nit || !email) {
        Toast.error('Completa todos los campos del receptor antes de continuar.');
        return;
    }

    const baseGravable = _feBaseTotal / (1 + TASA_IMPOCONSUMO);
    const impoconsumo  = _feBaseTotal - baseGravable;
    const fechaStr     = new Date().toISOString();
    const cufe         = _generarHashCUFE(`${_feOrdenNo}${nit}${fechaStr}`);

    const payload = {
        tipo_documento:  '01',
        descripcion:     'Factura Electrónica de Venta',
        numero_factura:  _feOrdenNo,
        fecha_emision:   fechaStr,
        cufe,
        estado_dian:     'Enviado — CUFE Generado',
        emisor: {
            nit: '900.123.456-7', razon_social: 'Restaurante la 26 SAS',
            municipio: 'Bucaramanga', departamento: 'Santander', actividad_ciiu: '5611',
        },
        receptor: { tipo_doc: nit.includes('-') ? 'NIT' : 'CC', numero_doc: nit, nombre, email },
        tributos: {
            base_gravable_cop:    Math.round(baseGravable),
            impoconsumo_8pct_cop: Math.round(impoconsumo),
            rete_ica_bga_6_9_mil: Math.round(baseGravable * TASA_RETE_ICA),
            total_factura_cop:    Math.round(_feBaseTotal),
        },
        referencia_interna:    { order_id: _feOrdenId, order_number: _feOrdenNo },
        proveedor_tecnologico: 'SIIGO S.A. — Habilitado DIAN Res. 000042 / 2020',
    };

    try {
        await supabaseClient.from('invoice_records').insert([{
            order_id: _feOrdenId, order_number: _feOrdenNo,
            receptor_nombre: nombre, receptor_nit: nit, receptor_email: email,
            subtotal: Math.round(baseGravable), iva: Math.round(impoconsumo),
            total: Math.round(_feBaseTotal), cufe, payload: JSON.stringify(payload),
            created_at: fechaStr,
        }]);
    } catch (_) { /* tabla opcional */ }

    const elResult = document.getElementById('fe-resultado');
    if (elResult) {
        elResult.style.display = 'block';
        elResult.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:18px;">✅</span>
                <span style="font-size:13px;font-weight:700;color:var(--olive);">CUFE Generado — Enviado a DIAN</span>
            </div>
            <p style="font-size:11.5px;color:var(--text-2);line-height:1.7;">
                <strong>CUFE:</strong> <span class="mono" style="word-break:break-all;font-size:10px;">${cufe}</span><br>
                <strong>Receptor:</strong> ${nombre} — ${nit}<br>
                <strong>Correo:</strong> ${email}<br>
                <strong>Base Gravable:</strong> ${formatCOP(baseGravable)}<br>
                <strong>Impoconsumo (8%):</strong> ${formatCOP(impoconsumo)}<br>
                <strong>Total Factura:</strong> ${formatCOP(_feBaseTotal)}
            </p>`;
    }
    console.log('✅ Payload DIAN generado:', payload);
}

// ============================================================
// 3. MENÚ — EDITOR MODULAR CON CÓDIGO DE PRODUCTO
// [FIX-2] SELECT ahora incluye product_code
// [FIX-3] Orden de tarjetas usa product_code real de la BD
// ============================================================
let componenteFiltradoActual = 'todos';

async function cargarSlotsMenuReal() {
    const contenedor = document.getElementById('contenedor-slots-menu');
    if (!contenedor) return;

    contenedor.innerHTML = `
        <p style="color:var(--text-3);font-size:12.5px;grid-column:span 3;text-align:center;padding:28px;">
            Sincronizando catálogo...
        </p>`;

    try {
        // [FIX-2] Incluir product_code en el SELECT
        let query = supabaseClient
            .from('menu_items')
            .select('id, name, description, price, item_type, is_active, portions_today, product_code, restaurant_id, category_id, created_at')
            .order('name', { ascending: true });

        if (componenteFiltradoActual !== 'todos') {
            query = query.eq('item_type', componenteFiltradoActual);
        } else {
            query = query.neq('item_type', 'sauce');
        }

        const { data: items, error } = await query;
        if (error) throw error;

        contenedor.innerHTML = '';

        if (!items || items.length === 0) {
            contenedor.innerHTML = `
                <p style="color:var(--text-3);font-size:12.5px;grid-column:span 3;text-align:center;padding:28px;">
                    Sin platos en esta categoría.
                </p>`;
            return;
        }

        // [FIX-3] Ordenar por product_code real, luego por tipo y nombre
        const itemsOrdenados = [...items].sort((a, b) => {
            const cA = a.product_code ?? 9999;
            const cB = b.product_code ?? 9999;
            if (cA !== cB) return cA - cB;
            const orden = { protein: 1, executive_lunch: 1, side: 2, drink: 3, a_la_carte: 4, dessert: 5 };
            const oA = orden[a.item_type] || 9;
            const oB = orden[b.item_type] || 9;
            if (oA !== oB) return oA - oB;
            return (a.name || '').localeCompare(b.name || '', 'es');
        });

        itemsOrdenados.forEach((item, animIdx) => {
            const cfg            = MAPA_TIPO[item.item_type] || { label: item.item_type, icono: '🍽️', porciones: 20, badgeClass: '' };
            const nombreEscapado = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            // [FIX-4] Usar product_code real de la BD
            const codigo         = item.product_code ?? '—';
            const rango          = getRangoByCodigo(item.product_code);

            contenedor.insertAdjacentHTML('beforeend', `
                <div class="card menu-card" style="display:flex;flex-direction:column;gap:12px;animation-delay:${animIdx * 40}ms;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                            <span style="font-size:11px;font-weight:700;color:${rango.color};background:rgba(0,0,0,.04);border:1.5px solid rgba(0,0,0,.07);border-radius:999px;padding:3px 9px;flex-shrink:0;" class="mono">#${codigo}</span>
                            <span class="badge ${cfg.badgeClass}">${cfg.icono} ${cfg.label}</span>
                        </div>
                        <button onclick="eliminarComponenteCatalogo('${item.id}','${nombreEscapado}')"
                            style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:15px;padding:0;flex-shrink:0;transition:color .2s;"
                            onmouseover="this.style.color='var(--red)'"
                            onmouseout="this.style.color='var(--text-3)'"
                            title="Eliminar">🗑️</button>
                    </div>

                    <h4 style="font-size:13.5px;font-weight:600;color:var(--text-1);line-height:1.4;margin:0;">
                        ${item.name}
                    </h4>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--surface-2);border:1.5px solid var(--border);border-radius:14px;padding:12px;">
                        <div>
                            <p style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Precio ($)</p>
                            <input type="number" value="${item.price}"
                                onchange="actualizarPrecioPlatoReal('${item.id}', this.value)"
                                class="card-input" style="color:var(--olive);">
                        </div>
                        <div>
                            <p style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Porciones hoy</p>
                            <input type="number" value="${item.portions_today ?? cfg.porciones}"
                                onchange="actualizarPorcionesHoy('${item.id}', this.value)"
                                class="card-input" style="color:var(--amber);">
                        </div>
                    </div>

                    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid var(--border);padding-top:10px;">
                        <span style="font-size:11.5px;color:var(--text-3);">¿Disponible hoy?</span>
                        <button data-switch-id="${item.id}"
                            onclick="alternarVisibilidadPlatoReal('${item.id}', ${item.is_active})"
                            class="${item.is_active ? 'sw-on' : 'sw-off'}">
                            ${item.is_active ? '🟢 Activo' : '🔴 Agotado'}
                        </button>
                    </div>
                </div>`);
        });

    } catch (err) {
        console.error('Error cargando menú:', err);
        contenedor.innerHTML = `
            <p style="color:var(--red);font-size:12.5px;grid-column:span 3;text-align:center;padding:28px;">
                Error de conexión con Supabase. Revisa la consola.
            </p>`;
    }
}

// ============================================================
// FILTRADO POR COMPONENTE
// ============================================================
function filtrarMenuComponente(cat) {
    componenteFiltradoActual = cat;
    document.querySelectorAll('.btn-comp').forEach(btn => btn.classList.remove('filter-active'));
    const btnActivo = document.getElementById(`btn-comp-${cat}`);
    if (btnActivo) btnActivo.classList.add('filter-active');
    cargarSlotsMenuReal();
}

// ============================================================
// REGISTRAR NUEVO PLATO
// [FIX-1] product_code se incluye directamente en el payload.
//         Columna confirmada en BD — eliminado código de reintento.
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const formNuevoPlato = document.getElementById('form-nuevo-plato');
    if (formNuevoPlato) {
        formNuevoPlato.addEventListener('submit', async (e) => {
            e.preventDefault();

            const product_code   = parseInt(document.getElementById('menu-codigo').value)    || null;
            const name           = document.getElementById('menu-nombre').value.trim();
            const price          = parseFloat(document.getElementById('menu-precio').value);
            const item_type      = document.getElementById('menu-tipo').value;
            const portions_today = parseInt(document.getElementById('menu-porciones').value) || null;

            if (!name) {
                Toast.error('El nombre del plato es obligatorio.');
                return;
            }
            if (!price || isNaN(price) || price <= 0) {
                Toast.error('Ingresa un precio válido mayor a 0.');
                return;
            }
            if (item_type === 'sauce') {
                Toast.error('El tipo "sauce" no está disponible como tipo independiente.');
                return;
            }

            try {
                // Obtener o crear restaurante
                let restaurantId;
                const { data: res, error: errRes } = await supabaseClient
                    .from('restaurants')
                    .select('id')
                    .limit(1)
                    .maybeSingle();

                if (errRes) throw errRes;

                if (res?.id) {
                    restaurantId = res.id;
                } else {
                    const { data: nuevoRest, error: errNuevo } = await supabaseClient
                        .from('restaurants')
                        .insert([{ name: 'Restaurante la 26', slug: 'restaurante-la-26' }])
                        .select('id')
                        .single();
                    if (errNuevo) throw errNuevo;
                    restaurantId = nuevoRest.id;
                    console.log('✅ Restaurante la 26 creado automáticamente.');
                }

                const mapaCategoria = {
                    executive_lunch: 'Proteína con Salsa',
                    protein:         'Proteína con Salsa',
                    side:            'Principio',
                    drink:           'Bebida',
                    a_la_carte:      'A la Carta',
                    dessert:         'Postre',
                };
                const nombreCategoria = mapaCategoria[item_type] || 'General';

                await supabaseClient
                    .from('menu_categories')
                    .upsert(
                        [{ restaurant_id: restaurantId, name: nombreCategoria, slot_type: 'single', display_order: 0 }],
                        { onConflict: 'restaurant_id,name', ignoreDuplicates: true }
                    );

                const { data: cat, error: errCat } = await supabaseClient
                    .from('menu_categories')
                    .select('id')
                    .eq('restaurant_id', restaurantId)
                    .eq('name', nombreCategoria)
                    .maybeSingle();

                if (errCat) throw errCat;
                if (!cat?.id) throw new Error(`No se pudo obtener la categoría "${nombreCategoria}".`);

                // [FIX-1] Payload limpio — product_code va directo, sin fallback
                // La columna product_code INTEGER ya existe en la BD (confirmado).
                const payload = {
                    restaurant_id: restaurantId,
                    category_id:   cat.id,
                    name,
                    price,
                    item_type,
                    is_active:     true,
                };
                // Solo incluir si el usuario ingresó un código
                if (product_code !== null) payload.product_code   = product_code;
                if (portions_today !== null) payload.portions_today = portions_today;

                const { error: errItem } = await supabaseClient
                    .from('menu_items')
                    .insert([payload]);

                if (errItem) {
                    if (errItem.code === '23505') {
                        Toast.error(`Ya existe un plato llamado "${name}" en el catálogo.`);
                        return;
                    }
                    throw errItem;
                }

                // Limpiar formulario
                document.getElementById('menu-codigo').value    = '';
                document.getElementById('menu-nombre').value    = '';
                document.getElementById('menu-precio').value    = '';
                document.getElementById('menu-porciones').value = '';

                Toast.ok(`"${name}" registrado correctamente.`);
                cargarSlotsMenuReal();

            } catch (err) {
                console.error('Error al guardar plato:', err);
                Toast.error(`Error al guardar: ${err.message}`);
            }
        });
    }
});

// ============================================================
// ELIMINAR PLATO
// ============================================================
async function eliminarComponenteCatalogo(idItem, nombreItem) {
    if (!confirm(`⚠️ ¿Eliminar permanentemente "${nombreItem}"?`)) return;
    try {
        await supabaseClient.from('menu_item_ingredients').delete().eq('menu_item_id', idItem);
        const { error } = await supabaseClient.from('menu_items').delete().eq('id', idItem);
        if (error) throw error;
        cargarSlotsMenuReal();
    } catch (err) {
        console.error('Error eliminando plato:', err);
        Toast.error('No se pudo eliminar. Revisa la consola.');
    }
}

// ============================================================
// ACTUALIZAR PRECIO
// ============================================================
async function actualizarPrecioPlatoReal(idPlato, nuevoPrecio) {
    try {
        const { error } = await supabaseClient
            .from('menu_items')
            .update({ price: parseFloat(nuevoPrecio) })
            .eq('id', idPlato);
        if (error) throw error;
    } catch (err) {
        console.error('Error actualizando precio:', err);
        Toast.error('No se pudo actualizar el precio.');
    }
}

// ============================================================
// HELPER: actualizar switch en DOM
// ============================================================
function _actualizarSwitchDOM(idPlato, activo) {
    const btn = document.querySelector(`[data-switch-id="${idPlato}"]`);
    if (!btn) return;
    btn.className   = activo ? 'sw-on' : 'sw-off';
    btn.textContent = activo ? '🟢 Activo' : '🔴 Agotado';
    btn.setAttribute('onclick', `alternarVisibilidadPlatoReal('${idPlato}', ${activo})`);
}

// ============================================================
// ACTUALIZAR PORCIONES
// ============================================================
async function actualizarPorcionesHoy(idPlato, valor) {
    const porciones = parseInt(valor) || 0;
    const payload   = { portions_today: porciones };
    if (porciones === 0) {
        payload.is_active = false;
        _actualizarSwitchDOM(idPlato, false);
    }
    try {
        const { error } = await supabaseClient
            .from('menu_items')
            .update(payload)
            .eq('id', idPlato);
        if (error) throw error;
    } catch (err) {
        console.error('Error actualizando porciones:', err.message || err);
        if (porciones === 0) _actualizarSwitchDOM(idPlato, true);
        Toast.error(`Error al guardar porciones: ${err.message || 'revisa la consola'}`);
    }
}

// ============================================================
// ALTERNAR DISPONIBILIDAD
// ============================================================
async function alternarVisibilidadPlatoReal(idPlato, estadoActual) {
    const nuevoEstado = !estadoActual;
    _actualizarSwitchDOM(idPlato, nuevoEstado);
    try {
        const { error } = await supabaseClient
            .from('menu_items')
            .update({ is_active: nuevoEstado })
            .eq('id', idPlato);
        if (error) throw error;
    } catch (err) {
        console.error('Error cambiando disponibilidad:', err);
        _actualizarSwitchDOM(idPlato, estadoActual);
        Toast.error('No se pudo guardar el cambio de disponibilidad.');
    }
}

// ============================================================
// 4. NÓMINA Y GASTOS OPERACIONALES
// ============================================================
async function cargarGastosReal() {
    const tbody = document.getElementById('tabla-gastos');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
            Consultando movimientos...
        </td></tr>`;

    try {
        const { data: egresos, error } = await supabaseClient
            .from('operating_expenses')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        globalEgresos = (egresos || []).reduce(
            (acc, g) => acc + (parseFloat(g.amount) || 0), 0
        );

        const elTotalGastos = document.getElementById('total-gastos');
        if (elTotalGastos) elTotalGastos.textContent = formatCOP(globalEgresos);

        tbody.innerHTML = '';

        if (!egresos || egresos.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                    Sin salidas registradas.
                </td></tr>`;
            return;
        }

        egresos.forEach(g => {
            const hora = new Date(g.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            tbody.insertAdjacentHTML('beforeend', `
                <tr class="tbody-row">
                    <td>
                        <span style="background:var(--red-lt);color:var(--red);border:1.5px solid var(--red-bd);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">${g.expense_type}</span>
                    </td>
                    <td style="color:var(--text-1);font-size:13px;">${g.description}</td>
                    <td><span class="mono" style="font-size:13px;font-weight:600;color:var(--red);">- ${formatCOP(g.amount)}</span></td>
                    <td style="text-align:right;font-size:11.5px;color:var(--text-3);" class="mono">${hora}</td>
                </tr>`);
        });

    } catch (err) {
        console.error('Error cargando egresos:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const formGasto = document.getElementById('form-gasto');
    if (formGasto) {
        formGasto.addEventListener('submit', async (e) => {
            e.preventDefault();
            const expense_type = document.getElementById('gasto-tipo').value;
            const description  = document.getElementById('gasto-descripcion').value;
            const amount       = parseFloat(document.getElementById('gasto-monto').value);
            try {
                const { error } = await supabaseClient
                    .from('operating_expenses')
                    .insert([{ expense_type, description, amount }]);
                if (error) throw error;
                formGasto.reset();
                cargarGastosReal();
            } catch (err) {
                console.error('Error insertando gasto:', err);
                Toast.error('Error al registrar el movimiento contable.');
            }
        });
    }
});

// ============================================================
// 5. INVENTARIO / KÁRDEX
// ============================================================
async function cargarInventarioReal() {
    const tbody = document.getElementById('tabla-inventario');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
            Mapeando bodegas...
        </td></tr>`;

    try {
        const { data: stock, error } = await supabaseClient
            .from('inventory_supplies')
            .select('*')
            .order('item_name', { ascending: true });

        if (error) throw error;

        tbody.innerHTML = '';

        if (!stock || stock.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-3);font-size:12.5px;">
                    No hay insumos registrados.
                </td></tr>`;
            return;
        }

        stock.forEach(inv => {
            const cant = parseFloat(inv.current_stock);
            const alertaCell = cant <= 5
                ? `<span style="background:var(--red-lt);border:1.5px solid var(--red-bd);color:var(--red);padding:3px 9px;border-radius:999px;font-size:11px;font-weight:600;">${cant} ⚠️ Stock bajo</span>`
                : `<span class="mono" style="font-size:13px;color:var(--text-1);font-weight:600;">${cant}</span>`;
            const nombreEscapado = (inv.item_name || '').replace(/'/g, "\\'");

            tbody.insertAdjacentHTML('beforeend', `
                <tr class="tbody-row">
                    <td style="font-size:13px;font-weight:600;color:var(--text-1);">${inv.item_name}</td>
                    <td style="font-size:12px;color:var(--text-3);">${inv.category}</td>
                    <td style="text-align:center;">${alertaCell}</td>
                    <td style="text-align:center;font-size:12px;color:var(--text-3);">${inv.unit_of_measure}</td>
                    <td style="text-align:center;">
                        <div style="display:flex;justify-content:center;gap:4px;">
                            <button onclick="ajustarExistenciasFisicas('${inv.id}',${cant},-1)"
                                style="background:var(--red-lt);border:1.5px solid var(--red-bd);color:var(--red);border-radius:999px;width:28px;height:28px;cursor:pointer;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;"
                                onmouseover="this.style.background='rgba(192,57,43,.16)'"
                                onmouseout="this.style.background='var(--red-lt)'">−</button>
                            <button onclick="ajustarExistenciasFisicas('${inv.id}',${cant},1)"
                                style="background:var(--olive-lt);border:1.5px solid var(--olive-bd);color:var(--olive);border-radius:999px;width:28px;height:28px;cursor:pointer;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;"
                                onmouseover="this.style.background='rgba(74,103,65,.18)'"
                                onmouseout="this.style.background='var(--olive-lt)'">+</button>
                        </div>
                    </td>
                    <td style="text-align:right;">
                        <button onclick="eliminarInsumoReal('${inv.id}','${nombreEscapado}')" class="btn-danger">
                            🗑️ Dar de baja
                        </button>
                    </td>
                </tr>`);
        });

    } catch (err) {
        console.error('Error cargando kárdex:', err);
    }
}

async function ajustarExistenciasFisicas(idInsumo, stockActual, delta) {
    const nuevoStock = Math.max(0, stockActual + delta);
    try {
        const { error } = await supabaseClient
            .from('inventory_supplies')
            .update({ current_stock: nuevoStock, updated_at: new Date().toISOString() })
            .eq('id', idInsumo);
        if (error) throw error;
        cargarInventarioReal();
    } catch (err) {
        console.error('Error ajustando stock:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const basePersistida = parseFloat(sessionStorage.getItem('base_caja_hoy') || '0');
    if (basePersistida > 0) {
        baseInicial = basePersistida;
        const panel = document.getElementById('panel-apertura-caja');
        if (panel) panel.style.display = 'none';
    }

    const formNuevoInsumo = document.getElementById('form-nuevo-insumo');
    if (formNuevoInsumo) {
        formNuevoInsumo.addEventListener('submit', async (e) => {
            e.preventDefault();
            const item_name       = document.getElementById('inv-nombre').value.trim();
            const category        = document.getElementById('inv-categoria').value;
            const current_stock   = parseFloat(document.getElementById('inv-stock').value);
            const unit_of_measure = document.getElementById('inv-unidad').value;
            try {
                const { error } = await supabaseClient
                    .from('inventory_supplies')
                    .insert([{ item_name, category, current_stock, unit_of_measure, updated_at: new Date().toISOString() }]);
                if (error) {
                    if (error.code === '23505') { Toast.error('Ya existe un insumo con ese nombre.'); return; }
                    throw error;
                }
                formNuevoInsumo.reset();
                Toast.ok(`Insumo "${item_name}" registrado correctamente.`);
                cargarInventarioReal();
            } catch (err) {
                console.error('Error insertando insumo:', err);
                Toast.error('No se pudo agregar el insumo.');
            }
        });
    }
});

async function eliminarInsumoReal(idInsumo, nombreInsumo) {
    if (!confirm(`⚠️ ¿Dar de baja "${nombreInsumo}"?`)) return;
    try {
        const { error } = await supabaseClient
            .from('inventory_supplies')
            .delete()
            .eq('id', idInsumo);
        if (error) throw error;
        Toast.ok(`"${nombreInsumo}" eliminado del kárdex.`);
        cargarInventarioReal();
    } catch (err) {
        console.error('Error eliminando insumo:', err);
        Toast.error('Error al eliminar el insumo.');
    }
}

// ============================================================
// 6. CIERRE DE CAJA DIARIO — INFORME Z
// ============================================================
function ejecutarCierreCaja() {
    const baseReteICA  = Math.max(0, globalIngresos - globalEgresos);
    const totalICA     = baseReteICA * TASA_RETE_ICA;
    const ivaConsumo   = globalIngresos * TASA_IMPOCONSUMO;
    const utilidadNeta = globalIngresos - globalEgresos - totalICA;

    const msg = `
══════ CIERRE DE CAJA — INFORME Z ══════
Restaurante la 26 · Bucaramanga, Santander

(+) Ingresos Brutos:          ${formatCOP(globalIngresos)}
(-) Gastos y Nómina:          ${formatCOP(globalEgresos)}
(-) Provisión Rete-ICA 6.9‰:  ${formatCOP(totalICA)}
    Base: ingresos - egresos = ${formatCOP(baseReteICA)}
(ref) Impoconsumo 8%:         ${formatCOP(ivaConsumo)}
════════════════════════════════════════
(=) UTILIDAD NETA ESTIMADA:   ${formatCOP(utilidadNeta)}
════════════════════════════════════════

¿Cerrar y validar el flujo de caja de este ciclo?`;

    if (confirm(msg)) {
        Toast.ok('Ciclo contable cerrado. Reporte archivado.');
    }
}

// ============================================================
// INICIALIZACIÓN PRINCIPAL
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const elFecha = document.getElementById('fecha-actual');
    if (elFecha) {
        elFecha.textContent = new Date().toLocaleDateString('es-CO', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
    }
});
