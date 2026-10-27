using System;
using System.Threading.Tasks;

namespace Sample
{
    /*
     * 注文を処理する。
     * 在庫の確認は呼び出し側で行う。
     */
    public sealed class OrderService
    {
        private const string Query = @"
SELECT id, name
FROM orders
WHERE status = 'open'";

        // 件数の上限
        private readonly int _limit = 100;

        public async Task<int> CountAsync(string name)
        {
            var message = $"{name} の注文を数える";
            Console.WriteLine(message);
            return await Task.FromResult(_limit);
        }

        public bool IsValid(string s) => s.Length > 0 && s != "<script>";
    }
}
