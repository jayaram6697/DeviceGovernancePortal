using System.ComponentModel.DataAnnotations;
using System.Collections.Generic;

namespace DeviceGovernancePlatform.Server.Models;

public sealed record ApprovalDecisionDto : IValidatableObject
{
    [Required]
    [StringLength(500)]
    public string Reason { get; init; } = string.Empty;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if ((Reason?.Trim().Length ?? 0) < 12)
        {
            yield return new ValidationResult(
                "Reason must contain at least 12 non-whitespace characters.",
                [nameof(Reason)]);
        }
    }
}