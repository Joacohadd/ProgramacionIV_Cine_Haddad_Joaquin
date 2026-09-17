import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configurado = Boolean(environment.supabase.url && environment.supabase.publicKey);
  readonly client: SupabaseClient | null = this.configurado
    ? createClient(environment.supabase.url, environment.supabase.publicKey)
    : null;
}
